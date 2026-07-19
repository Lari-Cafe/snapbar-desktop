use std::sync::{Arc, Mutex};

use chrono::Local;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const MAX_BUFFER_CHARS: usize = 256;
const TYPO_FIRE_LABEL: &str = "typo-fire";
const TYPO_FIRE_URL: &str = "index.html#/typo-fire";
const TYPO_FIRE_W: f64 = 780.0;
const TYPO_FIRE_H: f64 = 640.0;
const TYPO_FIRE_SKIP_TASKBAR: bool = false;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypoFireSettings {
    pub enabled: bool,
    pub prefix: String,
    pub trigger_mode: TriggerMode,
    pub backend: ExpansionBackend,
    pub search_shortcut: String,
    pub toggle_shortcut: String,
    pub undo_backspace: bool,
    pub allow_scripts: bool,
    pub app_filters: AppFilters,
}

impl Default for TypoFireSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            prefix: "/".to_string(),
            trigger_mode: TriggerMode::Suffix,
            backend: ExpansionBackend::Clipboard,
            search_shortcut: String::new(),
            toggle_shortcut: String::new(),
            undo_backspace: true,
            allow_scripts: false,
            app_filters: AppFilters::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TriggerMode {
    Suffix,
    Word,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExpansionBackend {
    Clipboard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppFilters {
    pub mode: AppFilterMode,
    pub entries: Vec<String>,
}

impl Default for AppFilters {
    fn default() -> Self {
        Self {
            mode: AppFilterMode::Disabled,
            entries: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppFilterMode {
    Disabled,
    Include,
    Exclude,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypoFireMatch {
    pub id: String,
    pub label: String,
    pub triggers: Vec<String>,
    pub replace: String,
    pub match_type: MatchType,
    pub variables: Vec<TypoFireVariable>,
    pub form_fields: Vec<TypoFireFormField>,
    pub app_filters: AppFilters,
    pub enabled: bool,
    #[serde(default)]
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MatchType {
    Literal,
    Regex,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypoFireVariable {
    pub name: String,
    pub kind: VariableKind,
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VariableKind {
    Date,
    Time,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypoFireFormField {
    pub name: String,
    pub label: String,
    pub field_type: FormFieldType,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FormFieldType {
    Text,
    Select,
    Choice,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppContext {
    pub executable: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypoFireExpansion {
    pub match_id: String,
    pub label: String,
    pub trigger: String,
    pub replace: String,
    pub delete_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypoFireSuggestion {
    pub match_id: String,
    pub label: String,
    pub trigger: String,
    pub preview: String,
    pub delete_chars: usize,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypoFireSuggestionPayload {
    pub prefix: String,
    pub query: String,
    pub selected_index: usize,
    pub suggestions: Vec<TypoFireSuggestion>,
}

const TYPO_FIRE_POPUP_LABEL: &str = "typo-fire-popup";
const TYPO_FIRE_POPUP_URL: &str = "index.html#/typo-fire-popup";
const TYPO_FIRE_FEEDBACK_EVENT: &str = "typo-fire://feedback";

fn reveal_typo_fire_window(win: &WebviewWindow) {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

#[tauri::command]
pub async fn open_typo_fire_window(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(TYPO_FIRE_LABEL) {
        reveal_typo_fire_window(&existing);
        return Ok(());
    }

    let win =
        WebviewWindowBuilder::new(&app, TYPO_FIRE_LABEL, WebviewUrl::App(TYPO_FIRE_URL.into()))
            .title("Typo Fire")
            .inner_size(TYPO_FIRE_W, TYPO_FIRE_H)
            .min_inner_size(TYPO_FIRE_W, TYPO_FIRE_H)
            .max_inner_size(TYPO_FIRE_W, TYPO_FIRE_H)
            .decorations(false)
            .transparent(true)
            .skip_taskbar(TYPO_FIRE_SKIP_TASKBAR)
            .center()
            .always_on_top(true)
            .resizable(false)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(|_| "Nao foi possivel abrir o Typo Fire.".to_string())?;

    reveal_typo_fire_window(&win);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypoFireFeedback {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypoFireStatus {
    pub enabled: bool,
    pub loaded_matches: usize,
    pub backend: ExpansionBackend,
    pub hook_active: bool,
    pub last_error: Option<String>,
    pub keystrokes_seen: u64,
    pub last_activity_at: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct TypoFireHookStatus {
    active: bool,
    last_error: Option<String>,
}

#[derive(Clone, Default)]
pub struct TypoFireState {
    settings: Arc<Mutex<TypoFireSettings>>,
    matches: Arc<Mutex<Vec<TypoFireMatch>>>,
    buffer: Arc<Mutex<String>>,
    app: Arc<Mutex<Option<AppHandle>>>,
    last_suggestions: Arc<Mutex<Option<TypoFireSuggestionPayload>>>,
    hook_status: Arc<Mutex<TypoFireHookStatus>>,
    keystrokes_seen: Arc<Mutex<u64>>,
    last_activity_at: Arc<Mutex<Option<String>>>,
}

impl TypoFireState {
    pub fn set_app(&self, app: AppHandle) -> Result<(), String> {
        *self.app.lock().map_err(|e| e.to_string())? = Some(app);
        Ok(())
    }

    pub fn app_handle(&self) -> Option<AppHandle> {
        self.app.lock().ok().and_then(|app| app.clone())
    }

    pub fn set_last_suggestions(&self, payload: TypoFireSuggestionPayload) -> Result<(), String> {
        *self.last_suggestions.lock().map_err(|e| e.to_string())? = Some(payload);
        Ok(())
    }

    pub fn clear_last_suggestions(&self) -> Result<(), String> {
        *self.last_suggestions.lock().map_err(|e| e.to_string())? = None;
        Ok(())
    }

    pub fn current_suggestion(
        &self,
        match_id: &str,
        trigger: &str,
    ) -> Result<Option<TypoFireSuggestion>, String> {
        Ok(self
            .last_suggestions
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .and_then(|payload| {
                payload
                    .suggestions
                    .iter()
                    .find(|suggestion| {
                        suggestion.match_id == match_id && suggestion.trigger == trigger
                    })
                    .cloned()
            }))
    }

    pub fn last_suggestions(&self) -> Result<Option<TypoFireSuggestionPayload>, String> {
        Ok(self
            .last_suggestions
            .lock()
            .map_err(|e| e.to_string())?
            .clone())
    }

    fn set_hook_status(&self, active: bool, last_error: Option<String>) {
        if let Ok(mut status) = self.hook_status.lock() {
            status.active = active;
            status.last_error = last_error;
        }
    }

    fn hook_status(&self) -> TypoFireHookStatus {
        self.hook_status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_default()
    }

    fn record_keyboard_activity(&self) {
        if let Ok(mut count) = self.keystrokes_seen.lock() {
            *count += 1;
        }
        if let Ok(mut last_activity) = self.last_activity_at.lock() {
            *last_activity = Some(Local::now().format("%H:%M:%S").to_string());
        }
    }

    pub fn status(&self) -> Result<TypoFireStatus, String> {
        let settings = self.settings.lock().map_err(|e| e.to_string())?;
        let matches = self.matches.lock().map_err(|e| e.to_string())?;
        let hook = self.hook_status();
        let keystrokes_seen = *self.keystrokes_seen.lock().map_err(|e| e.to_string())?;
        let last_activity_at = self
            .last_activity_at
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        Ok(TypoFireStatus {
            enabled: settings.enabled,
            loaded_matches: matches.len(),
            backend: settings.backend.clone(),
            hook_active: hook.active,
            last_error: hook.last_error,
            keystrokes_seen,
            last_activity_at,
        })
    }

    #[cfg(windows)]
    fn ensure_platform_hook(&self) {
        windows_hook::ensure_hook(self.clone());
    }

    #[cfg(not(windows))]
    fn ensure_platform_hook(&self) {}
}

pub fn push_to_ring_buffer(buffer: &mut String, text: &str) {
    buffer.push_str(text);
    let len = buffer.chars().count();
    if len > MAX_BUFFER_CHARS {
        let keep_from = len - MAX_BUFFER_CHARS;
        *buffer = buffer.chars().skip(keep_from).collect();
    }
}

pub fn find_expansion(
    buffer: &str,
    matches: &[TypoFireMatch],
    app_context: Option<&AppContext>,
) -> Option<TypoFireExpansion> {
    matches.iter().find_map(|candidate| {
        if !candidate.enabled || !app_allowed(&candidate.app_filters, app_context) {
            return None;
        }

        candidate
            .triggers
            .iter()
            .find_map(|trigger| match candidate.match_type {
                MatchType::Literal => {
                    let (expansion, confirmed_by_delimiter) =
                        literal_expansion(buffer, candidate, trigger)?;
                    if !confirmed_by_delimiter
                        && literal_trigger_has_longer_active_match(trigger, matches, app_context)
                    {
                        None
                    } else {
                        Some(expansion)
                    }
                }
                MatchType::Regex => regex_expansion(buffer, candidate, trigger),
            })
    })
}

pub fn find_suggestions(
    buffer: &str,
    prefix: &str,
    matches: &[TypoFireMatch],
) -> Vec<TypoFireSuggestion> {
    if prefix.is_empty() {
        return Vec::new();
    }
    let Some(active_query) = active_prefix_query(buffer, prefix) else {
        return Vec::new();
    };
    if active_query.chars().count() <= prefix.chars().count() {
        return Vec::new();
    }
    let delete_chars = active_query.chars().count();

    let mut suggestions = matches
        .iter()
        .enumerate()
        .filter(|(_, candidate)| candidate.enabled)
        .flat_map(|(match_index, candidate)| {
            let active_query = active_query.clone();
            candidate
                .triggers
                .iter()
                .enumerate()
                .filter_map(move |(trigger_index, trigger)| {
                    if trigger.starts_with(&active_query) {
                        Some((
                            match_index,
                            trigger_index,
                            TypoFireSuggestion {
                                match_id: candidate.id.clone(),
                                label: candidate.label.clone(),
                                trigger: trigger.clone(),
                                preview: preview_text(&candidate.replace),
                                delete_chars,
                                favorite: candidate.favorite,
                            },
                        ))
                    } else {
                        None
                    }
                })
        })
        .collect::<Vec<_>>();
    suggestions.sort_by_key(|(match_index, trigger_index, suggestion)| {
        (
            suggestion.trigger != active_query,
            suggestion
                .trigger
                .chars()
                .count()
                .saturating_sub(active_query.chars().count()),
            !suggestion.favorite,
            *match_index,
            *trigger_index,
        )
    });
    suggestions.truncate(5);
    suggestions
        .into_iter()
        .map(|(_, _, suggestion)| suggestion)
        .collect()
}

fn literal_trigger_has_longer_active_match(
    trigger: &str,
    matches: &[TypoFireMatch],
    app_context: Option<&AppContext>,
) -> bool {
    matches.iter().any(|candidate| {
        candidate.enabled
            && candidate.match_type == MatchType::Literal
            && app_allowed(&candidate.app_filters, app_context)
            && candidate
                .triggers
                .iter()
                .any(|other| other != trigger && other.starts_with(trigger))
    })
}

fn preview_text(value: &str) -> String {
    let clean = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut preview = clean.chars().take(64).collect::<String>();
    if clean.chars().count() > 64 {
        preview.push('…');
    }
    preview
}

fn active_prefix_query(buffer: &str, prefix: &str) -> Option<String> {
    let start = buffer.rfind(prefix)?;
    let query = &buffer[start..];
    if query.chars().any(char::is_whitespace) {
        return None;
    }
    Some(query.to_string())
}

fn show_suggestion_popup(
    app: AppHandle,
    payload: TypoFireSuggestionPayload,
    x: i32,
    y: i32,
) -> Result<(), String> {
    if payload.suggestions.is_empty() {
        hide_suggestion_popup(&app);
        return Ok(());
    }

    let height = (44 + (payload.suggestions.len() as u32 * 39)).clamp(88, 278);
    let window = if let Some(existing) = app.get_webview_window(TYPO_FIRE_POPUP_LABEL) {
        existing
    } else {
        WebviewWindowBuilder::new(
            &app,
            TYPO_FIRE_POPUP_LABEL,
            WebviewUrl::App(TYPO_FIRE_POPUP_URL.into()),
        )
        .title("Typo Fire")
        .inner_size(320.0, height as f64)
        .decorations(false)
        .transparent(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focusable(false)
        .resizable(false)
        .shadow(true)
        .visible(false)
        .build()
        .map_err(|e| format!("create Typo Fire popup: {e}"))?
    };

    window
        .set_size(PhysicalSize::new(320, height))
        .map_err(|e| format!("resize Typo Fire popup: {e}"))?;
    let _ = window.set_focusable(false);
    let top_y = y - height as i32 - 12;
    let popup_y = if top_y > 8 { top_y } else { y + 22 };
    let _ = window.set_position(PhysicalPosition::new(x + 14, popup_y));
    let _ = window.emit("typo-fire://suggestions", payload);
    window
        .show()
        .map_err(|e| format!("show Typo Fire popup: {e}"))?;
    Ok(())
}

fn hide_suggestion_popup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(TYPO_FIRE_POPUP_LABEL) {
        let _ = window.hide();
    }
}

fn literal_expansion(
    buffer: &str,
    candidate: &TypoFireMatch,
    trigger: &str,
) -> Option<(TypoFireExpansion, bool)> {
    if buffer.ends_with(trigger) {
        return Some((
            TypoFireExpansion {
                match_id: candidate.id.clone(),
                label: candidate.label.clone(),
                trigger: trigger.to_string(),
                replace: render_replacement(candidate),
                delete_chars: trigger.chars().count(),
            },
            false,
        ));
    }

    let delimiter = trailing_delimiter_after_trigger(buffer, trigger)?;
    Some((
        TypoFireExpansion {
            match_id: candidate.id.clone(),
            label: candidate.label.clone(),
            trigger: trigger.to_string(),
            replace: format!("{}{}", render_replacement(candidate), delimiter),
            delete_chars: trigger.chars().count() + 1,
        },
        true,
    ))
}

fn trailing_delimiter_after_trigger(buffer: &str, trigger: &str) -> Option<char> {
    let delimiter = buffer.chars().next_back()?;
    if !is_trigger_delimiter(delimiter) {
        return None;
    }
    let before_delimiter = buffer.strip_suffix(delimiter)?;
    if before_delimiter.ends_with(trigger) {
        Some(delimiter)
    } else {
        None
    }
}

fn is_trigger_delimiter(value: char) -> bool {
    value.is_whitespace() || matches!(value, '.' | ',' | ';' | ':' | '!' | '?' | ')' | ']' | '}')
}

fn regex_expansion(
    buffer: &str,
    candidate: &TypoFireMatch,
    trigger: &str,
) -> Option<TypoFireExpansion> {
    let regex = Regex::new(trigger).ok()?;
    let matched = regex.find(buffer)?;
    if matched.end() != buffer.len() {
        return None;
    }

    Some(TypoFireExpansion {
        match_id: candidate.id.clone(),
        label: candidate.label.clone(),
        trigger: matched.as_str().to_string(),
        replace: regex
            .replace(matched.as_str(), candidate.replace.as_str())
            .to_string(),
        delete_chars: matched.as_str().chars().count(),
    })
}

fn render_replacement(candidate: &TypoFireMatch) -> String {
    let mut rendered = candidate.replace.clone();
    for variable in &candidate.variables {
        let format = variable.format.as_deref().unwrap_or(match variable.kind {
            VariableKind::Date => "%Y-%m-%d",
            VariableKind::Time => "%H:%M",
        });
        let value = Local::now().format(format).to_string();
        rendered = rendered.replace(&format!("{{{{{}}}}}", variable.name), &value);
    }
    rendered
}

fn app_allowed(filters: &AppFilters, app_context: Option<&AppContext>) -> bool {
    match filters.mode {
        AppFilterMode::Disabled => true,
        AppFilterMode::Include => {
            let Some(context) = app_context else {
                return false;
            };
            filters
                .entries
                .iter()
                .any(|entry| app_context_matches(entry, context))
        }
        AppFilterMode::Exclude => {
            let Some(context) = app_context else {
                return true;
            };
            !filters
                .entries
                .iter()
                .any(|entry| app_context_matches(entry, context))
        }
    }
}

fn app_context_matches(entry: &str, context: &AppContext) -> bool {
    let needle = entry.to_ascii_lowercase();
    context
        .executable
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .contains(&needle)
        || context
            .title
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .contains(&needle)
}

#[tauri::command]
pub fn typo_fire_status(state: tauri::State<'_, TypoFireState>) -> Result<TypoFireStatus, String> {
    state.status()
}

#[tauri::command]
pub fn typo_fire_set_enabled(
    state: tauri::State<'_, TypoFireState>,
    enabled: bool,
) -> Result<TypoFireStatus, String> {
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
    settings.enabled = enabled;
    drop(settings);
    if enabled {
        state.ensure_platform_hook();
    }
    state.status()
}

#[tauri::command]
pub fn typo_fire_configure(
    app: AppHandle,
    state: tauri::State<'_, TypoFireState>,
    settings: TypoFireSettings,
    matches: Vec<TypoFireMatch>,
) -> Result<TypoFireStatus, String> {
    state.set_app(app.clone())?;
    *state.settings.lock().map_err(|e| e.to_string())? = settings;
    *state.matches.lock().map_err(|e| e.to_string())? = matches;
    state.clear_last_suggestions()?;
    hide_suggestion_popup(&app);
    state.ensure_platform_hook();
    state.status()
}

#[tauri::command]
pub fn typo_fire_reload(state: tauri::State<'_, TypoFireState>) -> Result<TypoFireStatus, String> {
    state.ensure_platform_hook();
    state.status()
}

#[tauri::command]
pub fn typo_fire_preview_expansion(
    state: tauri::State<'_, TypoFireState>,
    buffer: String,
) -> Result<Option<TypoFireExpansion>, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    if !settings.enabled {
        return Ok(None);
    }
    let matches = state.matches.lock().map_err(|e| e.to_string())?.clone();
    Ok(find_expansion(&buffer, &matches, None))
}

#[tauri::command]
pub fn typo_fire_preview_suggestions(
    state: tauri::State<'_, TypoFireState>,
    buffer: String,
) -> Result<Vec<TypoFireSuggestion>, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    if !settings.enabled {
        return Ok(Vec::new());
    }
    let matches = state.matches.lock().map_err(|e| e.to_string())?.clone();
    Ok(find_suggestions(&buffer, &settings.prefix, &matches))
}

#[tauri::command]
pub fn typo_fire_current_suggestions(
    state: tauri::State<'_, TypoFireState>,
) -> Result<Option<TypoFireSuggestionPayload>, String> {
    state.last_suggestions()
}

#[tauri::command]
pub fn typo_fire_apply_suggestion(
    app: AppHandle,
    state: tauri::State<'_, TypoFireState>,
    match_id: String,
    trigger: String,
    delete_chars: usize,
) -> Result<(), String> {
    apply_suggestion_to_app(&app, &state, &match_id, &trigger, delete_chars)
}

fn apply_suggestion_to_app(
    app: &AppHandle,
    state: &TypoFireState,
    match_id: &str,
    trigger: &str,
    delete_chars: usize,
) -> Result<(), String> {
    let Some(current_suggestion) = state.current_suggestion(match_id, trigger)? else {
        return Err("Typo Fire: sugestao expirada".to_string());
    };
    if current_suggestion.delete_chars != delete_chars {
        return Err("Typo Fire: sugestao invalida".to_string());
    }

    let matches = state.matches.lock().map_err(|e| e.to_string())?.clone();
    let Some(candidate) = matches
        .iter()
        .find(|candidate| candidate.enabled && candidate.id == match_id)
    else {
        return Err("Typo Fire: preset nao encontrado".to_string());
    };
    if !candidate.triggers.iter().any(|item| item == trigger) {
        return Err("Typo Fire: atalho nao encontrado".to_string());
    }
    if current_suggestion.delete_chars == 0
        || current_suggestion.delete_chars > trigger.chars().count()
    {
        return Err("Typo Fire: atalho invalido".to_string());
    }

    if let Ok(mut buffer) = state.buffer.lock() {
        buffer.clear();
    }
    let _ = state.clear_last_suggestions();
    hide_suggestion_popup(&app);
    let replace = render_replacement(candidate);
    let delete_chars = current_suggestion.delete_chars;
    let app = Some(app.clone());
    std::thread::spawn(move || apply_expansion(app, delete_chars, replace));
    Ok(())
}

#[tauri::command]
pub fn typo_fire_push_text(
    state: tauri::State<'_, TypoFireState>,
    text: String,
) -> Result<Option<TypoFireExpansion>, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let matches = state.matches.lock().map_err(|e| e.to_string())?.clone();
    if !settings.enabled {
        return Ok(None);
    }

    let mut buffer = state.buffer.lock().map_err(|e| e.to_string())?;
    push_to_ring_buffer(&mut buffer, &text);
    Ok(find_expansion(&buffer, &matches, None))
}

#[cfg(windows)]
fn apply_expansion(app: Option<AppHandle>, delete_chars: usize, replace: String) {
    crate::text_insertion::restore_last_external_focus();
    if crate::text_insertion::paste_text_after_backspaces(delete_chars, replace.clone()).is_err() {
        let _ = crate::text_insertion::copy_text(&replace);
        emit_feedback(app, "Texto copiado; cole manualmente.");
    }
}

#[cfg(not(windows))]
fn apply_expansion(app: Option<AppHandle>, _delete_chars: usize, replace: String) {
    if crate::text_insertion::copy_text(&replace).is_ok() {
        emit_feedback(app, "Texto copiado; cole manualmente.");
    }
}

fn emit_feedback(app: Option<AppHandle>, message: &str) {
    if let Some(app) = app {
        let _ = app.emit(
            TYPO_FIRE_FEEDBACK_EVENT,
            TypoFireFeedback {
                message: message.to_string(),
            },
        );
    }
}

#[cfg(windows)]
mod windows_hook {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::OnceLock;
    use std::thread;
    use std::time::Duration;

    use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, GetKeyboardState, ToUnicode, VIRTUAL_KEY, VK_BACK, VK_CONTROL, VK_DOWN,
        VK_ESCAPE, VK_MENU, VK_RETURN, VK_SHIFT, VK_UP,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetCursorPos, GetGUIThreadInfo, GetMessageW, SetWindowsHookExW,
        GUITHREADINFO, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, MSLLHOOKSTRUCT,
        WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_RBUTTONDOWN,
        WM_SYSKEYDOWN,
    };

    static HOOK_STARTED: AtomicBool = AtomicBool::new(false);
    static POPUP_EPOCH: AtomicU64 = AtomicU64::new(0);
    static ENGINE: OnceLock<TypoFireState> = OnceLock::new();
    const TO_UNICODE_NO_STATE_CHANGE: u32 = 0x04;

    pub fn ensure_hook(state: TypoFireState) {
        let engine = ENGINE.get_or_init(|| state.clone()).clone();
        if HOOK_STARTED
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            engine.set_hook_status(true, None);
            return;
        }

        thread::spawn(move || unsafe {
            let keyboard_hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0);
            if keyboard_hook.is_err() {
                engine.set_hook_status(
                    false,
                    Some("Typo Fire nao conseguiu ativar o teclado global.".to_string()),
                );
                HOOK_STARTED.store(false, Ordering::SeqCst);
                return;
            }
            let _mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0);
            engine.set_hook_status(true, None);

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).into() {}
            engine.set_hook_status(
                false,
                Some("Typo Fire parou de ouvir o teclado global.".to_string()),
            );
            HOOK_STARTED.store(false, Ordering::SeqCst);
        });
    }

    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let info = *(lparam.0 as *const KBDLLHOOKSTRUCT);
            let is_keydown = wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN;
            let injected = info.flags.contains(LLKHF_INJECTED);

            if is_keydown && !injected {
                if handle_suggestion_key(info.vkCode) {
                    return LRESULT(1);
                } else if info.vkCode == VK_BACK.0 as u32 {
                    pop_buffer_char();
                } else if let Some(text) = vk_to_text(info.vkCode, info.scanCode) {
                    process_text(text);
                }
            }
        }

        CallNextHookEx(None, code, wparam, lparam)
    }

    fn handle_suggestion_key(vk_code: u32) -> bool {
        let Some(engine) = ENGINE.get().cloned() else {
            return false;
        };
        if !has_suggestions(&engine) {
            return false;
        }

        if vk_code == VK_DOWN.0 as u32 {
            move_suggestion_selection(&engine, 1);
            return true;
        }
        if vk_code == VK_UP.0 as u32 {
            move_suggestion_selection(&engine, -1);
            return true;
        }
        if vk_code == VK_RETURN.0 as u32 {
            apply_selected_suggestion(&engine);
            return true;
        }
        if vk_code == VK_ESCAPE.0 as u32 {
            hide_popup(&engine);
            return true;
        }
        false
    }

    fn has_suggestions(engine: &TypoFireState) -> bool {
        engine
            .last_suggestions
            .lock()
            .ok()
            .and_then(|payload| {
                payload
                    .as_ref()
                    .map(|payload| !payload.suggestions.is_empty())
            })
            .unwrap_or(false)
    }

    fn move_suggestion_selection(engine: &TypoFireState, delta: isize) {
        let Some(payload) = update_selected_suggestion(engine, delta) else {
            return;
        };
        if let Some(app) = engine.app_handle() {
            if let Some(window) = app.get_webview_window(TYPO_FIRE_POPUP_LABEL) {
                let _ = window.emit("typo-fire://suggestions", payload);
            }
        }
    }

    fn update_selected_suggestion(
        engine: &TypoFireState,
        delta: isize,
    ) -> Option<TypoFireSuggestionPayload> {
        let mut guard = engine.last_suggestions.lock().ok()?;
        let payload = guard.as_mut()?;
        let len = payload.suggestions.len();
        if len == 0 {
            return None;
        }
        let current = payload.selected_index.min(len - 1);
        payload.selected_index = if delta < 0 {
            current.checked_sub(1).unwrap_or(len - 1)
        } else {
            (current + 1) % len
        };
        Some(payload.clone())
    }

    fn apply_selected_suggestion(engine: &TypoFireState) {
        let Some(payload) = engine.last_suggestions().ok().flatten() else {
            return;
        };
        let Some(suggestion) = payload
            .suggestions
            .get(
                payload
                    .selected_index
                    .min(payload.suggestions.len().saturating_sub(1)),
            )
            .cloned()
        else {
            return;
        };
        let Some(app) = engine.app_handle() else {
            return;
        };
        let _ = apply_suggestion_to_app(
            &app,
            engine,
            &suggestion.match_id,
            &suggestion.trigger,
            suggestion.delete_chars,
        );
    }

    unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let message = wparam.0 as u32;
            if matches!(message, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN) {
                let info = *(lparam.0 as *const MSLLHOOKSTRUCT);
                hide_popup_after_outside_click(info.pt.x, info.pt.y);
            }
        }

        CallNextHookEx(None, code, wparam, lparam)
    }

    fn pop_buffer_char() {
        let Some(engine) = ENGINE.get() else {
            return;
        };
        if let Ok(mut buffer) = engine.buffer.lock() {
            buffer.pop();
            publish_suggestions(engine, &buffer);
        }
    }

    fn process_text(text: String) {
        let Some(engine) = ENGINE.get() else {
            return;
        };
        engine.record_keyboard_activity();
        let settings = match engine.settings.lock() {
            Ok(settings) => settings.clone(),
            Err(_) => return,
        };
        if !settings.enabled {
            return;
        }
        let matches = match engine.matches.lock() {
            Ok(matches) => matches.clone(),
            Err(_) => return,
        };

        let expansion = {
            let mut buffer = match engine.buffer.lock() {
                Ok(buffer) => buffer,
                Err(_) => return,
            };
            push_to_ring_buffer(&mut buffer, &text);
            let expansion = find_expansion(&buffer, &matches, None);
            if expansion.is_some() {
                buffer.clear();
            } else {
                publish_suggestions(engine, &buffer);
            }
            expansion
        };

        if let Some(expansion) = expansion {
            hide_popup(engine);
            let app = engine.app_handle();
            thread::spawn(move || {
                apply_expansion(app, expansion.delete_chars, expansion.replace);
            });
        }
    }

    fn publish_suggestions(engine: &TypoFireState, buffer: &str) {
        let settings = match engine.settings.lock() {
            Ok(settings) => settings.clone(),
            Err(_) => return,
        };
        if !settings.enabled {
            let _ = engine.clear_last_suggestions();
            hide_popup(engine);
            return;
        }
        let matches = match engine.matches.lock() {
            Ok(matches) => matches.clone(),
            Err(_) => return,
        };
        let query = active_prefix_query(buffer, &settings.prefix).unwrap_or_default();
        let suggestions = find_suggestions(buffer, &settings.prefix, &matches);
        if suggestions.is_empty() {
            let _ = engine.clear_last_suggestions();
            hide_popup(engine);
            return;
        }
        let Some(app) = engine.app_handle() else {
            return;
        };
        let payload = TypoFireSuggestionPayload {
            prefix: settings.prefix,
            query,
            selected_index: 0,
            suggestions,
        };
        if engine.set_last_suggestions(payload.clone()).is_err() {
            return;
        }
        let popup_epoch = POPUP_EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
        let popup_engine = engine.clone();
        thread::spawn(move || {
            let (x, y) = caret_position().unwrap_or_else(cursor_position);
            if show_suggestion_popup(app, payload, x, y).is_ok() {
                hide_popup_after_delay(popup_epoch);
            } else if POPUP_EPOCH.load(Ordering::SeqCst) == popup_epoch {
                hide_popup(&popup_engine);
            }
        });
    }

    fn hide_popup(engine: &TypoFireState) {
        let _ = engine.clear_last_suggestions();
        if let Some(app) = engine.app_handle() {
            thread::spawn(move || hide_suggestion_popup(&app));
        }
    }

    fn hide_popup_after_outside_click(x: i32, y: i32) {
        let Some(engine) = ENGINE.get().cloned() else {
            return;
        };
        thread::spawn(move || {
            if click_inside_popup(&engine, x, y) {
                return;
            }
            POPUP_EPOCH.fetch_add(1, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(140));
            hide_popup(&engine);
        });
    }

    fn click_inside_popup(engine: &TypoFireState, x: i32, y: i32) -> bool {
        let Some(app) = engine.app_handle() else {
            return false;
        };
        let Some(window) = app.get_webview_window(TYPO_FIRE_POPUP_LABEL) else {
            return false;
        };
        let Ok(position) = window.outer_position() else {
            return false;
        };
        let Ok(size) = window.outer_size() else {
            return false;
        };
        x >= position.x
            && y >= position.y
            && x <= position.x + size.width as i32
            && y <= position.y + size.height as i32
    }

    fn hide_popup_after_delay(popup_epoch: u64) {
        let Some(engine) = ENGINE.get().cloned() else {
            return;
        };
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(10));
            if POPUP_EPOCH.load(Ordering::SeqCst) == popup_epoch {
                hide_popup(&engine);
            }
        });
    }

    fn caret_position() -> Option<(i32, i32)> {
        unsafe {
            let mut info = GUITHREADINFO::default();
            info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
            if GetGUIThreadInfo(0, &mut info).is_err() || info.hwndCaret.0.is_null() {
                return None;
            }

            let mut point = POINT {
                x: info.rcCaret.left,
                y: info.rcCaret.bottom,
            };
            if ClientToScreen(info.hwndCaret, &mut point).as_bool() {
                Some((point.x, point.y))
            } else {
                None
            }
        }
    }

    fn cursor_position() -> (i32, i32) {
        unsafe {
            let mut point = POINT::default();
            if GetCursorPos(&mut point).is_ok() {
                (point.x, point.y)
            } else {
                (80, 80)
            }
        }
    }

    fn vk_to_text(vk_code: u32, scan_code: u32) -> Option<String> {
        unsafe {
            if key_down(VK_CONTROL) || key_down(VK_MENU) {
                return None;
            }

            let mut keyboard_state = [0u8; 256];
            if GetKeyboardState(&mut keyboard_state).is_err() {
                return None;
            }
            if key_down(VK_SHIFT) {
                keyboard_state[VK_SHIFT.0 as usize] |= 0x80;
            }

            let mut out = [0u16; 8];
            let len = ToUnicode(
                vk_code,
                scan_code,
                Some(&keyboard_state),
                &mut out,
                TO_UNICODE_NO_STATE_CHANGE,
            );
            if len <= 0 {
                return None;
            }

            Some(String::from_utf16_lossy(&out[..len as usize]))
        }
    }

    fn key_down(key: VIRTUAL_KEY) -> bool {
        unsafe { (GetKeyState(key.0 as i32) as u16 & 0x8000) != 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_match(id: &str, triggers: Vec<&str>, replace: &str) -> TypoFireMatch {
        TypoFireMatch {
            id: id.to_string(),
            label: id.to_string(),
            triggers: triggers.into_iter().map(str::to_string).collect(),
            replace: replace.to_string(),
            match_type: MatchType::Literal,
            variables: Vec::new(),
            form_fields: Vec::new(),
            app_filters: AppFilters::default(),
            enabled: true,
            favorite: false,
        }
    }

    fn favorite_match(id: &str, triggers: Vec<&str>, replace: &str) -> TypoFireMatch {
        let mut item = sample_match(id, triggers, replace);
        item.favorite = true;
        item
    }

    #[test]
    fn typo_fire_window_has_its_own_taskbar_tab() {
        assert!(!TYPO_FIRE_SKIP_TASKBAR);
        assert_eq!(TYPO_FIRE_URL, "index.html#/typo-fire");
    }

    #[test]
    fn suggests_enabled_matches_after_slash_prefix() {
        let matches = vec![
            sample_match("oi", vec!["/oi"], "ola"),
            sample_match("email", vec!["/email"], "a@b.com"),
        ];

        let suggestions = find_suggestions("texto /o", "/", &matches);

        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].label, "oi");
        assert_eq!(suggestions[0].trigger, "/oi");
    }

    #[test]
    fn does_not_suggest_on_prefix_only() {
        let matches = vec![sample_match("oi", vec!["/oi"], "ola")];

        assert!(find_suggestions("texto /", "/", &matches).is_empty());
    }

    #[test]
    fn suggestions_follow_the_typed_query_and_limit_preview_to_five() {
        let matches = vec![
            sample_match("planejamento", vec!["/planejamento"], "Plano da semana"),
            sample_match("planeta", vec!["/planeta"], "Planeta Terra"),
            sample_match("plantas", vec!["/plantasvszombies"], "Plantas vs Zombies"),
            sample_match("plano", vec!["/plano"], "Plano rapido"),
            sample_match("planilha", vec!["/planilha"], "Planilha modelo"),
            sample_match("plantao", vec!["/plantao"], "Plantao atualizado"),
            sample_match("oi", vec!["/oi"], "ola"),
        ];

        let suggestions = find_suggestions("texto /plan", "/", &matches);

        assert_eq!(suggestions.len(), 5);
        assert_eq!(
            suggestions
                .iter()
                .map(|suggestion| suggestion.trigger.as_str())
                .collect::<Vec<_>>(),
            vec![
                "/plano",
                "/planeta",
                "/plantao",
                "/planilha",
                "/planejamento"
            ],
        );
    }

    #[test]
    fn suggestions_rank_exact_and_closer_triggers_before_favorites() {
        let matches = vec![
            favorite_match("plantas", vec!["/plantasvszombies"], "Plantas"),
            sample_match("plan", vec!["/plan"], "Plano curto"),
            sample_match("planejamento", vec!["/planejamento"], "Plano longo"),
            favorite_match("planeta", vec!["/planeta"], "Planeta"),
        ];

        let suggestions = find_suggestions("texto /plan", "/", &matches);

        assert_eq!(
            suggestions
                .iter()
                .map(|suggestion| suggestion.trigger.as_str())
                .collect::<Vec<_>>(),
            vec!["/plan", "/planeta", "/planejamento", "/plantasvszombies"],
        );
    }

    #[test]
    fn suggestions_delete_only_the_typed_query_when_applying_longer_trigger() {
        let matches = vec![sample_match(
            "planejamento",
            vec!["/planejamento"],
            "Plano da semana",
        )];

        let suggestions = find_suggestions("texto /plan", "/", &matches);

        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].trigger, "/planejamento");
        assert_eq!(suggestions[0].delete_chars, 5);
    }

    #[test]
    fn does_not_auto_expand_literal_trigger_that_is_prefix_of_another_literal_trigger() {
        let matches = vec![
            sample_match("sex", vec!["/sex"], "short"),
            sample_match("sexo", vec!["/sexo"], "long"),
            sample_match("img", vec!["/img"], "image short"),
            sample_match("imgem", vec!["/imgem"], "image long"),
        ];

        assert!(find_expansion("texto /sex", &matches, None).is_none());
        assert!(find_expansion("texto /img", &matches, None).is_none());

        let expansion = find_expansion("texto /sexo", &matches, None).unwrap();
        assert_eq!(expansion.match_id, "sexo");
        assert_eq!(expansion.replace, "long");
    }

    #[test]
    fn expands_shorter_prefix_trigger_after_user_confirms_with_delimiter() {
        let matches = vec![
            sample_match("sex", vec!["/sex"], "short"),
            sample_match("sexo", vec!["/sexo"], "long"),
        ];

        let expansion = find_expansion("texto /sex ", &matches, None).unwrap();

        assert_eq!(expansion.match_id, "sex");
        assert_eq!(expansion.replace, "short ");
        assert_eq!(expansion.delete_chars, 5);
    }

    #[test]
    fn auto_expands_unique_literal_trigger() {
        let matches = vec![sample_match("email", vec!["/email"], "hello@example.com")];

        let expansion = find_expansion("texto /email", &matches, None).unwrap();

        assert_eq!(expansion.match_id, "email");
        assert_eq!(expansion.delete_chars, 6);
    }

    #[test]
    fn clears_stale_suggestions_when_matches_are_reconfigured() {
        let state = TypoFireState::default();
        state
            .set_last_suggestions(TypoFireSuggestionPayload {
                prefix: "/".to_string(),
                query: "/o".to_string(),
                selected_index: 0,
                suggestions: find_suggestions(
                    "texto /o",
                    "/",
                    &[sample_match("oi", vec!["/oi"], "ola")],
                ),
            })
            .unwrap();

        state.clear_last_suggestions().unwrap();

        assert_eq!(state.last_suggestions().unwrap(), None);
    }

    #[test]
    fn status_reports_global_hook_state_and_last_error() {
        let state = TypoFireState::default();
        state.set_hook_status(
            false,
            Some("Typo Fire nao conseguiu ativar o teclado global.".to_string()),
        );

        let status = state.status().unwrap();

        assert!(!status.hook_active);
        assert_eq!(
            status.last_error.as_deref(),
            Some("Typo Fire nao conseguiu ativar o teclado global.")
        );
        assert_eq!(status.keystrokes_seen, 0);
        assert_eq!(status.last_activity_at, None);

        state.record_keyboard_activity();
        let status = state.status().unwrap();

        assert_eq!(status.keystrokes_seen, 1);
        assert!(status.last_activity_at.is_some());
    }

    #[test]
    fn current_suggestion_only_returns_live_backend_suggestions() {
        let state = TypoFireState::default();
        let suggestions = find_suggestions(
            "texto /plan",
            "/",
            &[sample_match(
                "planejamento",
                vec!["/planejamento"],
                "Plano da semana",
            )],
        );
        state
            .set_last_suggestions(TypoFireSuggestionPayload {
                prefix: "/".to_string(),
                query: "/plan".to_string(),
                selected_index: 0,
                suggestions,
            })
            .unwrap();

        let live = state
            .current_suggestion("planejamento", "/planejamento")
            .unwrap()
            .unwrap();
        assert_eq!(live.delete_chars, 5);

        state.clear_last_suggestions().unwrap();
        assert!(state
            .current_suggestion("planejamento", "/planejamento")
            .unwrap()
            .is_none());
    }

    #[test]
    fn matches_simple_literal_trigger_at_buffer_end() {
        let matches = vec![sample_match("email", vec![":email"], "me@example.com")];

        let expansion = find_expansion("hello :email", &matches, None).unwrap();

        assert_eq!(expansion.match_id, "email");
        assert_eq!(expansion.trigger, ":email");
        assert_eq!(expansion.replace, "me@example.com");
        assert_eq!(expansion.delete_chars, 6);
    }

    #[test]
    fn matches_any_trigger_from_the_same_match() {
        let matches = vec![sample_match("thanks", vec![":ty", ":thanks"], "thanks!")];

        let expansion = find_expansion("ok :ty", &matches, None).unwrap();

        assert_eq!(expansion.trigger, ":ty");
        assert_eq!(expansion.replace, "thanks!");
    }

    #[test]
    fn skips_disabled_matches() {
        let mut disabled = sample_match("email", vec![":email"], "me@example.com");
        disabled.enabled = false;

        assert!(find_expansion(":email", &[disabled], None).is_none());
    }

    #[test]
    fn supports_regex_triggers_at_buffer_end() {
        let mut m = sample_match("issue", vec![r":issue-(\d+)"], "ISSUE-$1");
        m.match_type = MatchType::Regex;

        let expansion = find_expansion("fix :issue-42", &[m], None).unwrap();

        assert_eq!(expansion.trigger, ":issue-42");
        assert_eq!(expansion.replace, "ISSUE-42");
        assert_eq!(expansion.delete_chars, 9);
    }

    #[test]
    fn respects_app_exclude_filters() {
        let mut m = sample_match("secret", vec![":pw"], "blocked");
        m.app_filters = AppFilters {
            mode: AppFilterMode::Exclude,
            entries: vec!["keepass".to_string()],
        };

        let context = AppContext {
            executable: Some("KeePassXC.exe".to_string()),
            title: None,
        };

        assert!(find_expansion(":pw", &[m], Some(&context)).is_none());
    }

    #[test]
    fn ring_buffer_does_not_keep_unbounded_typed_text() {
        let mut buffer = String::new();

        push_to_ring_buffer(&mut buffer, &"x".repeat(MAX_BUFFER_CHARS + 20));

        assert_eq!(buffer.chars().count(), MAX_BUFFER_CHARS);
    }
}
