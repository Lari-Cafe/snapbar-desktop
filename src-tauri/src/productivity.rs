use chrono::{Datelike, Local, NaiveDate, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;

const PRODUCTIVITY_FILE: &str = "productivity.json";
const SCHEDULER_TICK_MS: u64 = 1_000;
const TODO_ALERT_REPEAT_MS: i64 = 30_000;

#[derive(Clone, Copy)]
struct ProductivityWindowSpec {
    label: &'static str,
    title: &'static str,
    url: &'static str,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    resizable: bool,
    always_on_top: bool,
    transparent: bool,
    shadow: bool,
}

fn productivity_window_specs() -> [ProductivityWindowSpec; 3] {
    [
        ProductivityWindowSpec {
            label: "todo-calendar",
            title: "To-do Calendar",
            url: "index.html#/todo-calendar",
            width: 860.0,
            height: 560.0,
            min_width: 760.0,
            min_height: 520.0,
            resizable: false,
            always_on_top: true,
            transparent: true,
            shadow: false,
        },
        ProductivityWindowSpec {
            label: "pomodoro",
            title: "Pomodoro",
            url: "index.html#/pomodoro",
            width: 500.0,
            height: 300.0,
            min_width: 480.0,
            min_height: 280.0,
            resizable: true,
            always_on_top: true,
            transparent: true,
            shadow: false,
        },
        ProductivityWindowSpec {
            label: "productivity-alert",
            title: "Lembrete",
            url: "index.html#/productivity-alert",
            width: 360.0,
            height: 176.0,
            min_width: 320.0,
            min_height: 150.0,
            resizable: false,
            always_on_top: true,
            transparent: true,
            shadow: false,
        },
    ]
}

fn productivity_window_spec(label: &str) -> Option<ProductivityWindowSpec> {
    productivity_window_specs()
        .into_iter()
        .find(|spec| spec.label == label)
}

async fn open_productivity_window(app: AppHandle, label: &str) -> Result<(), String> {
    let spec = productivity_window_spec(label).ok_or("Janela invalida.")?;

    if let Some(existing) = app.get_webview_window(spec.label) {
        existing
            .close()
            .map_err(|_| "Nao foi possivel fechar esta ferramenta.".to_string())?;
        return Ok(());
    }

    let _win = WebviewWindowBuilder::new(&app, spec.label, WebviewUrl::App(spec.url.into()))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .min_inner_size(spec.min_width, spec.min_height)
        .decorations(false)
        .transparent(spec.transparent)
        .skip_taskbar(true)
        .always_on_top(spec.always_on_top)
        .resizable(spec.resizable)
        .shadow(spec.shadow)
        .visible(false)
        .build()
        .map_err(|_| "Nao foi possivel abrir esta ferramenta.".to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn open_todo_calendar_window(app: AppHandle) -> Result<(), String> {
    open_productivity_window(app, "todo-calendar").await
}

#[tauri::command]
pub async fn open_pomodoro_window(app: AppHandle) -> Result<(), String> {
    open_productivity_window(app, "pomodoro").await
}

#[tauri::command]
pub async fn open_productivity_alert_window(
    app: AppHandle,
    todo_id: Option<String>,
) -> Result<(), String> {
    let spec = productivity_window_spec("productivity-alert").ok_or("Janela invalida.")?;
    if let Some(existing) = app.get_webview_window(spec.label) {
        let _ = existing.close();
    }
    let url = todo_id
        .filter(|id| !id.trim().is_empty())
        .map(|id| format!("{}?id={}", spec.url, sanitize_query_value(&id)))
        .unwrap_or_else(|| spec.url.to_string());
    WebviewWindowBuilder::new(&app, spec.label, WebviewUrl::App(url.into()))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .min_inner_size(spec.min_width, spec.min_height)
        .decorations(false)
        .transparent(spec.transparent)
        .skip_taskbar(true)
        .always_on_top(spec.always_on_top)
        .resizable(spec.resizable)
        .shadow(spec.shadow)
        .visible(false)
        .build()
        .map_err(|_| "Nao foi possivel abrir o alerta.".to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReminderList {
    pub id: String,
    pub name: String,
    pub color: String,
}

impl Default for ReminderList {
    fn default() -> Self {
        Self {
            id: "default".into(),
            name: "Geral".into(),
            color: "#8ab4ff".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReminderPriority {
    Low,
    Normal,
    High,
}

impl Default for ReminderPriority {
    fn default() -> Self {
        Self::Normal
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReminderRecurrence {
    None,
    Daily,
    Weekly,
    Monthly,
}

impl Default for ReminderRecurrence {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub due_at: Option<i64>,
    #[serde(default = "default_list_id")]
    pub list_id: String,
    #[serde(default)]
    pub priority: ReminderPriority,
    #[serde(default)]
    pub recurrence: ReminderRecurrence,
    pub completed_at: Option<i64>,
    pub snoozed_until: Option<i64>,
    pub last_notified_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Reminder {
    #[cfg(test)]
    fn default_for_test(id: &str) -> Self {
        let now: i64 = 1_800_000_000_000;
        Self {
            id: id.into(),
            title: "Lembrete".into(),
            notes: String::new(),
            due_at: None,
            list_id: default_list_id(),
            priority: ReminderPriority::Normal,
            recurrence: ReminderRecurrence::None,
            completed_at: None,
            snoozed_until: None,
            last_notified_at: None,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub date: String,
    pub due_at: Option<i64>,
    pub completed_at: Option<i64>,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub pomodoros_estimate: i64,
    pub linked_reminder_id: Option<String>,
    #[serde(default)]
    pub recurrence: TodoRecurrence,
    #[serde(default)]
    pub recurrence_weekdays: Vec<i64>,
    pub snoozed_until: Option<i64>,
    pub alert_dismissed_at: Option<i64>,
    pub last_notified_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl TodoItem {
    #[cfg(test)]
    fn default_for_test(id: &str) -> Self {
        let now = 1_800_000_000_000;
        Self {
            id: id.into(),
            title: "Tarefa".into(),
            notes: String::new(),
            date: "2026-06-06".into(),
            due_at: None,
            completed_at: None,
            order: 0,
            pomodoros_estimate: 0,
            linked_reminder_id: None,
            recurrence: TodoRecurrence::None,
            recurrence_weekdays: Vec::new(),
            snoozed_until: None,
            alert_dismissed_at: None,
            last_notified_at: None,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TodoRecurrence {
    None,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl Default for TodoRecurrence {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PomodoroRound {
    Focus,
    ShortBreak,
    LongBreak,
}

impl Default for PomodoroRound {
    fn default() -> Self {
        Self::Focus
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PomodoroStatus {
    Idle,
    Running,
    Paused,
}

impl Default for PomodoroStatus {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSettings {
    pub focus_minutes: i64,
    pub short_break_minutes: i64,
    pub long_break_minutes: i64,
    pub rounds_per_long_break: i64,
    pub auto_start_breaks: bool,
    pub auto_start_focus: bool,
}

impl Default for PomodoroSettings {
    fn default() -> Self {
        Self {
            focus_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            rounds_per_long_break: 4,
            auto_start_breaks: false,
            auto_start_focus: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroTimer {
    pub status: PomodoroStatus,
    pub round: PomodoroRound,
    pub round_index: i64,
    pub started_at: Option<i64>,
    pub paused_at: Option<i64>,
    pub remaining_seconds: i64,
    pub total_seconds: i64,
    pub active_todo_id: Option<String>,
}

impl PomodoroTimer {
    fn default_for_settings(settings: &PomodoroSettings) -> Self {
        let total = duration_for_round(PomodoroRound::Focus, settings);
        Self {
            status: PomodoroStatus::Idle,
            round: PomodoroRound::Focus,
            round_index: 0,
            started_at: None,
            paused_at: None,
            remaining_seconds: total,
            total_seconds: total,
            active_todo_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSession {
    pub id: String,
    pub round: PomodoroRound,
    pub todo_id: Option<String>,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_seconds: i64,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityState {
    pub version: i64,
    pub lists: Vec<ReminderList>,
    pub reminders: Vec<Reminder>,
    pub todo_items: Vec<TodoItem>,
    pub pomodoro_settings: PomodoroSettings,
    pub pomodoro_timer: PomodoroTimer,
    pub pomodoro_sessions: Vec<PomodoroSession>,
    pub updated_at: i64,
}

impl Default for ProductivityState {
    fn default() -> Self {
        let settings = PomodoroSettings::default();
        Self {
            version: 1,
            lists: vec![ReminderList::default()],
            reminders: Vec::new(),
            todo_items: Vec::new(),
            pomodoro_timer: PomodoroTimer::default_for_settings(&settings),
            pomodoro_settings: settings,
            pomodoro_sessions: Vec::new(),
            updated_at: now_ms(),
        }
    }
}

pub struct ProductivityStore {
    path: PathBuf,
    state: Mutex<ProductivityState>,
}

impl ProductivityStore {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let path = productivity_file_path(app)?;
        let state = load_state_from_disk(&path);
        Ok(Self {
            path,
            state: Mutex::new(normalize_state(state)),
        })
    }

    fn snapshot(&self) -> Result<ProductivityState, String> {
        self.state
            .lock()
            .map(|state| state.clone())
            .map_err(|_| "Nao foi possivel ler produtividade.".to_string())
    }

    fn replace(&self, state: ProductivityState) -> Result<ProductivityState, String> {
        let next = normalize_state(state);
        persist_state_to_disk(&self.path, &next)?;
        let mut guard = self
            .state
            .lock()
            .map_err(|_| "Nao foi possivel salvar produtividade.".to_string())?;
        *guard = next.clone();
        Ok(next)
    }

    fn mutate<F>(&self, update: F) -> Result<ProductivityState, String>
    where
        F: FnOnce(&mut ProductivityState),
    {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| "Nao foi possivel salvar produtividade.".to_string())?;
        update(&mut guard);
        guard.updated_at = now_ms();
        let next = normalize_state(guard.clone());
        persist_state_to_disk(&self.path, &next)?;
        *guard = next.clone();
        Ok(next)
    }
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DueAlerts {
    todos: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductivityDuePayload {
    id: String,
    title: String,
    body: String,
    kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PomodoroTickPayload {
    remaining_seconds: i64,
    total_seconds: i64,
    round: PomodoroRound,
    status: PomodoroStatus,
}

fn default_list_id() -> String {
    "default".into()
}

fn sanitize_query_value(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

fn productivity_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Nao foi possivel abrir os dados locais.".to_string())?;
    fs::create_dir_all(&dir)
        .map_err(|_| "Nao foi possivel preparar os dados locais.".to_string())?;
    Ok(dir.join(PRODUCTIVITY_FILE))
}

fn load_state_from_disk(path: &Path) -> ProductivityState {
    let Some(bytes) = fs::read(path).ok() else {
        return ProductivityState::default();
    };
    backup_legacy_reminders(path, &bytes);
    serde_json::from_slice::<ProductivityState>(&bytes).unwrap_or_default()
}

fn backup_legacy_reminders(path: &Path, bytes: &[u8]) {
    let Some(value) = serde_json::from_slice::<serde_json::Value>(bytes).ok() else {
        return;
    };
    let Some(reminders) = value.get("reminders").and_then(|item| item.as_array()) else {
        return;
    };
    if reminders.is_empty() {
        return;
    }
    let backup = serde_json::json!({
        "version": 1,
        "createdAt": now_ms(),
        "lists": value.get("lists").cloned().unwrap_or_else(|| serde_json::json!([])),
        "reminders": reminders,
    });
    let Some(parent) = path.parent() else {
        return;
    };
    if parent
        .read_dir()
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("productivity-reminders-backup-")
        })
    {
        return;
    }
    let backup_path = parent.join(format!("productivity-reminders-backup-{}.json", now_ms()));
    if backup_path.exists() {
        return;
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(&backup) {
        let _ = fs::write(backup_path, bytes);
    }
}

fn persist_state_to_disk(path: &Path, state: &ProductivityState) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|_| "Nao foi possivel salvar produtividade.".to_string())?;
    fs::write(path, bytes).map_err(|_| "Nao foi possivel salvar produtividade.".to_string())
}

fn normalize_state(mut state: ProductivityState) -> ProductivityState {
    state.version = 1;
    if !state.lists.iter().any(|list| list.id == "default") {
        state.lists.insert(0, ReminderList::default());
    }
    state.reminders.clear();
    state.todo_items.retain(|item| !item.id.trim().is_empty());
    for item in &mut state.todo_items {
        item.pomodoros_estimate = item.pomodoros_estimate.clamp(0, 24);
        item.recurrence_weekdays = normalize_weekdays(&item.recurrence_weekdays);
        if item.recurrence != TodoRecurrence::Weekly {
            item.recurrence_weekdays.clear();
        }
        if item.snoozed_until.is_some_and(|value| value <= 0) {
            item.snoozed_until = None;
        }
        if item.alert_dismissed_at.is_some_and(|value| value <= 0) {
            item.alert_dismissed_at = None;
        }
        if item.last_notified_at.is_some_and(|value| value <= 0) {
            item.last_notified_at = None;
        }
    }
    state.pomodoro_settings.focus_minutes = state.pomodoro_settings.focus_minutes.clamp(1, 240);
    state.pomodoro_settings.short_break_minutes =
        state.pomodoro_settings.short_break_minutes.clamp(1, 120);
    state.pomodoro_settings.long_break_minutes =
        state.pomodoro_settings.long_break_minutes.clamp(1, 180);
    state.pomodoro_settings.rounds_per_long_break =
        state.pomodoro_settings.rounds_per_long_break.clamp(1, 12);
    state.pomodoro_timer.total_seconds =
        duration_for_round(state.pomodoro_timer.round, &state.pomodoro_settings);
    state.pomodoro_timer.remaining_seconds = state
        .pomodoro_timer
        .remaining_seconds
        .clamp(0, state.pomodoro_timer.total_seconds);
    state
}

fn normalize_weekdays(values: &[i64]) -> Vec<i64> {
    let mut out = values
        .iter()
        .copied()
        .filter(|day| (0..=6).contains(day))
        .collect::<Vec<_>>();
    out.sort_unstable();
    out.dedup();
    out
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn duration_for_round(round: PomodoroRound, settings: &PomodoroSettings) -> i64 {
    match round {
        PomodoroRound::Focus => settings.focus_minutes * 60,
        PomodoroRound::ShortBreak => settings.short_break_minutes * 60,
        PomodoroRound::LongBreak => settings.long_break_minutes * 60,
    }
}

#[cfg(test)]
fn collect_due_alerts(state: &ProductivityState, now: i64) -> DueAlerts {
    DueAlerts {
        todos: state
            .todo_items
            .iter()
            .filter(|item| todo_due_for_alert(item, now))
            .map(|item| item.id.clone())
            .collect(),
    }
}

fn todo_due_for_alert(item: &TodoItem, now: i64) -> bool {
    let Some(due_at) = item.due_at else {
        return false;
    };
    if item.completed_at.is_some() {
        return false;
    }
    if item.snoozed_until.is_some_and(|snooze| snooze > now) {
        return false;
    }
    let alert_at = item
        .snoozed_until
        .filter(|snooze| *snooze <= now)
        .unwrap_or(due_at);
    if alert_at > now {
        return false;
    }
    if item
        .alert_dismissed_at
        .map(|dismissed| dismissed >= alert_at)
        .unwrap_or(false)
    {
        return false;
    }
    item.last_notified_at
        .map(|last| last < alert_at || now - last >= TODO_ALERT_REPEAT_MS)
        .unwrap_or(true)
}

fn next_todo_occurrence(item: &TodoItem) -> Option<(String, Option<i64>)> {
    if item.recurrence == TodoRecurrence::None {
        return None;
    }
    let current = NaiveDate::parse_from_str(&item.date, "%Y-%m-%d").ok()?;
    let next = match item.recurrence {
        TodoRecurrence::None => return None,
        TodoRecurrence::Daily => current.succ_opt()?,
        TodoRecurrence::Weekly => next_weekly_date(current, &item.recurrence_weekdays)?,
        TodoRecurrence::Monthly => add_months(current, 1)?,
        TodoRecurrence::Yearly => add_years(current, 1)?,
    };
    let due_at = item
        .due_at
        .and_then(|due| Local.timestamp_millis_opt(due).single())
        .and_then(|time| {
            Local
                .with_ymd_and_hms(
                    next.year(),
                    next.month(),
                    next.day(),
                    time.hour(),
                    time.minute(),
                    time.second(),
                )
                .single()
        })
        .map(|date| date.timestamp_millis());
    Some((next.format("%Y-%m-%d").to_string(), due_at))
}

fn next_weekly_date(current: NaiveDate, weekdays: &[i64]) -> Option<NaiveDate> {
    let selected = if weekdays.is_empty() {
        vec![current.weekday().num_days_from_sunday() as i64]
    } else {
        normalize_weekdays(weekdays)
    };
    for offset in 1..=7 {
        let candidate = current.checked_add_days(chrono::Days::new(offset))?;
        if selected.contains(&(candidate.weekday().num_days_from_sunday() as i64)) {
            return Some(candidate);
        }
    }
    current.checked_add_days(chrono::Days::new(7))
}

fn add_months(current: NaiveDate, months: i32) -> Option<NaiveDate> {
    let total = current.year() * 12 + current.month0() as i32 + months;
    let year = total.div_euclid(12);
    let month0 = total.rem_euclid(12) as u32;
    let day = current.day().min(days_in_month(year, month0 + 1)?);
    NaiveDate::from_ymd_opt(year, month0 + 1, day)
}

fn add_years(current: NaiveDate, years: i32) -> Option<NaiveDate> {
    let year = current.year() + years;
    let day = current.day().min(days_in_month(year, current.month())?);
    NaiveDate::from_ymd_opt(year, current.month(), day)
}

fn days_in_month(year: i32, month: u32) -> Option<u32> {
    let first_next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)?
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)?
    };
    Some(first_next.pred_opt()?.day())
}

fn start_timer(
    timer: &mut PomodoroTimer,
    settings: &PomodoroSettings,
    now: i64,
    active_todo_id: Option<String>,
) {
    if timer.status == PomodoroStatus::Running {
        return;
    }
    let total = duration_for_round(timer.round, settings);
    timer.status = PomodoroStatus::Running;
    timer.started_at = Some(now);
    timer.paused_at = None;
    if timer.status != PomodoroStatus::Paused && timer.remaining_seconds <= 0 {
        timer.remaining_seconds = total;
    }
    if timer.remaining_seconds <= 0 || timer.remaining_seconds > total {
        timer.remaining_seconds = total;
    }
    timer.total_seconds = total;
    timer.active_todo_id = active_todo_id;
}

fn pause_timer(timer: &mut PomodoroTimer, now: i64) {
    if timer.status != PomodoroStatus::Running {
        return;
    }
    let elapsed = timer
        .started_at
        .map(|started| ((now - started) / 1000).max(0))
        .unwrap_or(0);
    timer.remaining_seconds = (timer.remaining_seconds - elapsed).max(0);
    timer.status = PomodoroStatus::Paused;
    timer.started_at = None;
    timer.paused_at = Some(now);
}

fn resume_timer(timer: &mut PomodoroTimer, now: i64) {
    if timer.status != PomodoroStatus::Paused {
        return;
    }
    timer.status = PomodoroStatus::Running;
    timer.started_at = Some(now);
    timer.paused_at = None;
}

fn reset_timer(timer: &mut PomodoroTimer, settings: &PomodoroSettings) {
    let total = duration_for_round(timer.round, settings);
    timer.status = PomodoroStatus::Idle;
    timer.started_at = None;
    timer.paused_at = None;
    timer.remaining_seconds = total;
    timer.total_seconds = total;
}

fn remaining_seconds(timer: &PomodoroTimer, now: i64) -> i64 {
    if timer.status != PomodoroStatus::Running {
        return timer.remaining_seconds;
    }
    let elapsed = timer
        .started_at
        .map(|started| ((now - started) / 1000).max(0))
        .unwrap_or(0);
    (timer.remaining_seconds - elapsed).max(0)
}

fn skip_round(
    timer: &mut PomodoroTimer,
    settings: &PomodoroSettings,
    now: i64,
) -> Result<PomodoroSession, String> {
    let started_at = timer
        .started_at
        .unwrap_or_else(|| now - timer.total_seconds * 1000);
    let session = PomodoroSession {
        id: format!("pomo-session-{now}"),
        round: timer.round,
        todo_id: timer.active_todo_id.clone(),
        started_at,
        ended_at: now,
        duration_seconds: ((now - started_at) / 1000).max(1),
        completed: true,
    };
    let completed_focus_rounds = if timer.round == PomodoroRound::Focus {
        timer.round_index + 1
    } else {
        timer.round_index
    };
    let next_round = if timer.round != PomodoroRound::Focus {
        PomodoroRound::Focus
    } else if completed_focus_rounds > 0
        && completed_focus_rounds % settings.rounds_per_long_break == 0
    {
        PomodoroRound::LongBreak
    } else {
        PomodoroRound::ShortBreak
    };
    let total = duration_for_round(next_round, settings);
    timer.round = next_round;
    timer.round_index = completed_focus_rounds;
    timer.status = if next_round == PomodoroRound::Focus && settings.auto_start_focus {
        PomodoroStatus::Running
    } else if next_round != PomodoroRound::Focus && settings.auto_start_breaks {
        PomodoroStatus::Running
    } else {
        PomodoroStatus::Idle
    };
    timer.started_at = (timer.status == PomodoroStatus::Running).then_some(now);
    timer.paused_at = None;
    timer.remaining_seconds = total;
    timer.total_seconds = total;
    Ok(session)
}

fn emit_state_changed(app: &AppHandle, state: &ProductivityState) {
    let _ = app.emit("productivity://state-changed", state);
}

fn send_native_notification(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

fn emit_due_payload(app: &AppHandle, event: &str, payload: &ProductivityDuePayload) {
    let _ = app.emit(event, payload);
    send_native_notification(app, &payload.title, &payload.body);
    if payload.kind == "todo" {
        let app = app.clone();
        let todo_id = payload.id.clone();
        tauri::async_runtime::spawn(async move {
            let _ = open_productivity_alert_window(app, Some(todo_id)).await;
        });
    }
}

pub fn start_productivity_scheduler(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(SCHEDULER_TICK_MS));
        process_scheduler_tick(&app);
    });
}

fn process_scheduler_tick(app: &AppHandle) {
    let Some(store) = app.try_state::<ProductivityStore>() else {
        return;
    };
    let now = now_ms();
    let snapshot = match store.snapshot() {
        Ok(state) => state,
        Err(_) => return,
    };
    let timer_remaining = remaining_seconds(&snapshot.pomodoro_timer, now);
    let has_due_alerts = snapshot
        .todo_items
        .iter()
        .any(|item| todo_due_for_alert(item, now));
    let timer_finished =
        snapshot.pomodoro_timer.status == PomodoroStatus::Running && timer_remaining <= 0;

    if !has_due_alerts && !timer_finished {
        let _ = app.emit(
            "pomodoro://tick",
            PomodoroTickPayload {
                remaining_seconds: timer_remaining,
                total_seconds: snapshot.pomodoro_timer.total_seconds,
                round: snapshot.pomodoro_timer.round,
                status: snapshot.pomodoro_timer.status,
            },
        );
        return;
    }

    let mut due_payloads: Vec<(String, ProductivityDuePayload)> = Vec::new();
    let mut round_payload: Option<PomodoroSession> = None;

    let state = match store.mutate(|state| {
        for item in state
            .todo_items
            .iter_mut()
            .filter(|item| todo_due_for_alert(item, now))
        {
            item.last_notified_at = Some(now);
            item.updated_at = now;
            due_payloads.push((
                "productivity://todo-due".into(),
                ProductivityDuePayload {
                    id: item.id.clone(),
                    title: item.title.clone(),
                    body: "Lembrete de tarefa".into(),
                    kind: "todo".into(),
                },
            ));
        }

        let remaining = remaining_seconds(&state.pomodoro_timer, now);
        if state.pomodoro_timer.status == PomodoroStatus::Running && remaining <= 0 {
            if let Ok(session) =
                skip_round(&mut state.pomodoro_timer, &state.pomodoro_settings, now)
            {
                state.pomodoro_sessions.push(session.clone());
                round_payload = Some(session);
            }
        }
    }) {
        Ok(state) => state,
        Err(_) => return,
    };

    let timer_remaining = remaining_seconds(&state.pomodoro_timer, now);
    let _ = app.emit(
        "pomodoro://tick",
        PomodoroTickPayload {
            remaining_seconds: timer_remaining,
            total_seconds: state.pomodoro_timer.total_seconds,
            round: state.pomodoro_timer.round,
            status: state.pomodoro_timer.status,
        },
    );

    if !due_payloads.is_empty() || round_payload.is_some() {
        emit_state_changed(app, &state);
    }
    for (event, payload) in due_payloads {
        emit_due_payload(app, &event, &payload);
    }
    if let Some(session) = round_payload {
        let _ = app.emit("pomodoro://round-complete", &session);
        send_native_notification(app, "Pomodoro", "Rodada concluida");
    }
}

#[tauri::command]
pub fn productivity_get_state(
    store: State<'_, ProductivityStore>,
) -> Result<ProductivityState, String> {
    store.snapshot()
}

#[tauri::command]
pub fn productivity_save_state(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
    state: ProductivityState,
) -> Result<ProductivityState, String> {
    let next = store.replace(state)?;
    emit_state_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn productivity_upsert_todo(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
    item: TodoItem,
) -> Result<ProductivityState, String> {
    let next = store.mutate(|state| {
        if let Some(existing) = state
            .todo_items
            .iter_mut()
            .find(|existing| existing.id == item.id)
        {
            *existing = item;
        } else {
            state.todo_items.push(item);
        }
    })?;
    emit_state_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn productivity_complete_todo(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
    todo_id: String,
) -> Result<ProductivityState, String> {
    let now = now_ms();
    let next = store.mutate(|state| {
        if let Some(item) = state.todo_items.iter_mut().find(|item| item.id == todo_id) {
            if let Some((next_date, next_due_at)) = next_todo_occurrence(item) {
                item.date = next_date;
                item.due_at = next_due_at;
                item.completed_at = None;
            } else {
                item.completed_at = Some(now);
            }
            item.snoozed_until = None;
            item.alert_dismissed_at = None;
            item.last_notified_at = None;
            item.updated_at = now;
        }
    })?;
    emit_state_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn productivity_delete_todo(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
    todo_id: String,
) -> Result<ProductivityState, String> {
    let next = store.mutate(|state| {
        state.todo_items.retain(|item| item.id != todo_id);
    })?;
    emit_state_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn productivity_snooze_todo(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
    todo_id: String,
    minutes: i64,
) -> Result<ProductivityState, String> {
    let now = now_ms();
    let delay = minutes.clamp(1, 24 * 60) * 60_000;
    let next = store.mutate(|state| {
        if let Some(item) = state.todo_items.iter_mut().find(|item| item.id == todo_id) {
            item.snoozed_until = Some(now + delay);
            item.alert_dismissed_at = None;
            item.last_notified_at = None;
            item.updated_at = now;
        }
    })?;
    emit_state_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn productivity_dismiss_todo_alert(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
    todo_id: String,
) -> Result<ProductivityState, String> {
    let now = now_ms();
    let next = store.mutate(|state| {
        if let Some(item) = state.todo_items.iter_mut().find(|item| item.id == todo_id) {
            let alert_at = item
                .snoozed_until
                .filter(|snooze| *snooze <= now)
                .or(item.due_at)
                .unwrap_or(now);
            item.alert_dismissed_at = Some(alert_at.max(now));
            item.updated_at = now;
        }
    })?;
    emit_state_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn pomodoro_start_timer(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
    active_todo_id: Option<String>,
) -> Result<ProductivityState, String> {
    let now = now_ms();
    let next = store.mutate(|state| {
        start_timer(
            &mut state.pomodoro_timer,
            &state.pomodoro_settings,
            now,
            active_todo_id,
        );
    })?;
    emit_state_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn pomodoro_pause_timer(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
) -> Result<ProductivityState, String> {
    let now = now_ms();
    let next = store.mutate(|state| pause_timer(&mut state.pomodoro_timer, now))?;
    emit_state_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn pomodoro_resume_timer(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
) -> Result<ProductivityState, String> {
    let now = now_ms();
    let next = store.mutate(|state| resume_timer(&mut state.pomodoro_timer, now))?;
    emit_state_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn pomodoro_reset_timer(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
) -> Result<ProductivityState, String> {
    let next =
        store.mutate(|state| reset_timer(&mut state.pomodoro_timer, &state.pomodoro_settings))?;
    emit_state_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn pomodoro_skip_round(
    app: AppHandle,
    store: State<'_, ProductivityStore>,
) -> Result<ProductivityState, String> {
    let now = now_ms();
    let mut session: Option<PomodoroSession> = None;
    let next = store.mutate(|state| {
        if let Ok(done) = skip_round(&mut state.pomodoro_timer, &state.pomodoro_settings, now) {
            session = Some(done.clone());
            state.pomodoro_sessions.push(done);
        }
    })?;
    emit_state_changed(&app, &next);
    if let Some(done) = session {
        let _ = app.emit("pomodoro://round-complete", done);
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn productivity_windows_are_independent_tools() {
        let specs = productivity_window_specs();
        let labels = specs.iter().map(|spec| spec.label).collect::<Vec<_>>();

        assert_eq!(labels, ["todo-calendar", "pomodoro", "productivity-alert"]);
        assert!(specs.iter().all(|spec| spec.always_on_top));
        assert!(specs.iter().all(|spec| spec.transparent));
        assert!(specs.iter().all(|spec| !spec.shadow));
        assert_eq!(
            specs
                .iter()
                .find(|spec| spec.label == "pomodoro")
                .map(|spec| (
                    spec.min_width as i64,
                    spec.min_height as i64,
                    spec.resizable
                )),
            Some((480, 280, true))
        );
        assert!(specs
            .iter()
            .filter(|spec| spec.label != "pomodoro")
            .all(|spec| !spec.resizable));
    }

    #[test]
    fn main_productivity_windows_do_not_close_each_other() {
        let labels = productivity_window_specs()
            .iter()
            .map(|spec| spec.label)
            .collect::<Vec<_>>();

        assert!(labels.contains(&"todo-calendar"));
        assert!(labels.contains(&"pomodoro"));
    }

    #[test]
    fn due_alerts_skip_completed_snoozed_dismissed_and_recent_items() {
        let now = 1_800_000_000_000;
        let state = ProductivityState {
            reminders: vec![Reminder {
                id: "legacy-reminder".into(),
                title: "Nao deve alertar".into(),
                due_at: Some(now - 60_000),
                ..Reminder::default_for_test("legacy-reminder")
            }],
            todo_items: vec![
                TodoItem {
                    id: "due-todo".into(),
                    title: "Build".into(),
                    date: "2026-06-06".into(),
                    due_at: Some(now - 30_000),
                    ..TodoItem::default_for_test("due-todo")
                },
                TodoItem {
                    id: "recent".into(),
                    title: "Avisado agora".into(),
                    date: "2026-06-06".into(),
                    due_at: Some(now - 60_000),
                    last_notified_at: Some(now - 10_000),
                    ..TodoItem::default_for_test("recent")
                },
                TodoItem {
                    id: "dismissed".into(),
                    title: "Parado".into(),
                    date: "2026-06-06".into(),
                    due_at: Some(now - 60_000),
                    alert_dismissed_at: Some(now),
                    ..TodoItem::default_for_test("dismissed")
                },
            ],
            ..ProductivityState::default()
        };

        let alerts = collect_due_alerts(&state, now);

        assert_eq!(alerts.todos, vec!["due-todo"]);
    }

    #[test]
    fn completing_recurring_todo_moves_it_to_next_due_date() {
        let due_at = Local
            .with_ymd_and_hms(2026, 6, 8, 19, 30, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let mut state = ProductivityState {
            todo_items: vec![TodoItem {
                id: "gym".into(),
                title: "Academia".into(),
                date: "2026-06-08".into(),
                due_at: Some(due_at),
                recurrence: TodoRecurrence::Weekly,
                recurrence_weekdays: vec![1, 3],
                ..TodoItem::default_for_test("gym")
            }],
            ..ProductivityState::default()
        };

        if let Some(item) = state.todo_items.iter_mut().find(|item| item.id == "gym") {
            let (next_date, next_due_at) = next_todo_occurrence(item).unwrap();
            item.date = next_date;
            item.due_at = next_due_at;
            item.last_notified_at = None;
        }

        let item = &state.todo_items[0];
        assert_eq!(item.completed_at, None);
        assert_eq!(item.date, "2026-06-10");
        assert_eq!(
            item.due_at,
            Some(
                Local
                    .with_ymd_and_hms(2026, 6, 10, 19, 30, 0)
                    .single()
                    .unwrap()
                    .timestamp_millis()
            )
        );
        assert_eq!(item.last_notified_at, None);
    }

    #[test]
    fn pomodoro_start_pause_resume_and_skip_rounds() {
        let settings = PomodoroSettings::default();
        let mut timer = PomodoroTimer::default_for_settings(&settings);

        start_timer(&mut timer, &settings, 1_000, Some("todo-1".into()));
        assert_eq!(timer.status, PomodoroStatus::Running);
        assert_eq!(timer.total_seconds, settings.focus_minutes * 60);

        pause_timer(&mut timer, 31_000);
        assert_eq!(timer.status, PomodoroStatus::Paused);
        assert_eq!(timer.remaining_seconds, settings.focus_minutes * 60 - 30);

        resume_timer(&mut timer, 60_000);
        assert_eq!(timer.status, PomodoroStatus::Running);
        assert_eq!(timer.started_at, Some(60_000));

        timer.round_index = settings.rounds_per_long_break - 1;
        let session = skip_round(&mut timer, &settings, 70_000).unwrap();
        assert_eq!(session.round, PomodoroRound::Focus);
        assert_eq!(session.todo_id.as_deref(), Some("todo-1"));
        assert_eq!(timer.round, PomodoroRound::LongBreak);
        assert_eq!(timer.status, PomodoroStatus::Idle);
    }
}
