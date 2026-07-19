import { invoke } from "@tauri-apps/api/core";

export const PRODUCTIVITY_ANIMATION_MS = 450;
export const PRODUCTIVITY_CARD_STAGGER_MS = 35;
export const PRODUCTIVITY_EVENTS = {
  stateChanged: "productivity://state-changed",
  todoDue: "productivity://todo-due",
  pomodoroTick: "pomodoro://tick",
  pomodoroRoundComplete: "pomodoro://round-complete",
} as const;

export type ProductivityWindow = "todo-calendar" | "pomodoro" | "productivity-alert";
export type TodoRecurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";
type ReminderPriority = "low" | "normal" | "high";
type ReminderRecurrence = "none" | "daily" | "weekly" | "monthly";
export type PomodoroRound = "focus" | "shortBreak" | "longBreak";
export type PomodoroStatus = "idle" | "running" | "paused";

export interface ReminderList {
  id: string;
  name: string;
  color: string;
}

export interface Reminder {
  id: string;
  title: string;
  notes: string;
  dueAt: number | null;
  listId: string;
  priority: ReminderPriority;
  recurrence: ReminderRecurrence;
  completedAt: number | null;
  snoozedUntil: number | null;
  lastNotifiedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TodoItem {
  id: string;
  title: string;
  notes: string;
  date: string;
  dueAt: number | null;
  completedAt: number | null;
  order: number;
  pomodorosEstimate: number;
  linkedReminderId: string | null;
  recurrence: TodoRecurrence;
  recurrenceWeekdays: number[];
  snoozedUntil: number | null;
  alertDismissedAt: number | null;
  lastNotifiedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  roundsPerLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
}

export interface PomodoroTimer {
  status: PomodoroStatus;
  round: PomodoroRound;
  roundIndex: number;
  startedAt: number | null;
  pausedAt: number | null;
  remainingSeconds: number;
  totalSeconds: number;
  activeTodoId: string | null;
}

export interface PomodoroSession {
  id: string;
  round: PomodoroRound;
  todoId: string | null;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  completed: boolean;
}

export interface ProductivityState {
  version: 1;
  lists: ReminderList[];
  reminders: Reminder[];
  todoItems: TodoItem[];
  pomodoroSettings: PomodoroSettings;
  pomodoroTimer: PomodoroTimer;
  pomodoroSessions: PomodoroSession[];
  updatedAt: number;
}

export interface TodoBuckets {
  today: TodoItem[];
  overdue: TodoItem[];
}

export interface TodoOccurrence {
  date: string;
  dueAt: number | null;
}

export interface PomodoroCompletion {
  timer: PomodoroTimer;
  session: PomodoroSession;
}

export const DEFAULT_REMINDER_LIST: ReminderList = {
  id: "default",
  name: "Geral",
  color: "#8ab4ff",
};

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsPerLongBreak: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
};

const MAX_TITLE = 160;
const MAX_NOTES = 4_000;
const MS_PER_DAY = 86_400_000;
export const TODO_ALERT_REPEAT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function safeText(value: unknown, fallback = "", max = MAX_TITLE): string {
  const raw = typeof value === "string" ? value : fallback;
  return raw.trim().slice(0, max);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteOptionalTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const raw = Math.round(finiteNumber(value, fallback));
  return Math.max(min, Math.min(max, raw));
}

function normalizePriority(value: unknown): ReminderPriority {
  return value === "low" || value === "high" ? value : "normal";
}

function normalizeRecurrence(value: unknown): ReminderRecurrence {
  return value === "daily" || value === "weekly" || value === "monthly"
    ? value
    : "none";
}

function normalizeRound(value: unknown): PomodoroRound {
  return value === "shortBreak" || value === "longBreak" ? value : "focus";
}

function normalizeStatus(value: unknown): PomodoroStatus {
  return value === "running" || value === "paused" ? value : "idle";
}

function normalizeTodoRecurrence(value: unknown): TodoRecurrence {
  return value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "yearly"
    ? value
    : "none";
}

function normalizeWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry))
        .filter((entry) => entry >= 0 && entry <= 6),
    ),
  ).sort((a, b) => a - b);
}

function makeId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function localDateKey(timestamp: number = Date.now()): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeDateKey(value: unknown, fallback = localDateKey()): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return fallback;
}

export function shiftDateKeyMonth(
  dateKey: string,
  monthDelta: number,
  preferredDay = Number(normalizeDateKey(dateKey).slice(-2)),
): string {
  const normalized = normalizeDateKey(dateKey);
  const [year, month] = normalized.split("-").map(Number);
  const target = new Date(year, month - 1 + monthDelta, 1);
  const targetDay = Math.max(
    1,
    Math.min(
      31,
      Number.isInteger(preferredDay) ? preferredDay : Number(normalized.slice(-2)),
    ),
  );
  const day = Math.min(targetDay, daysInMonth(target.getFullYear(), target.getMonth()));
  return localDateKey(new Date(target.getFullYear(), target.getMonth(), day).getTime());
}

export function makeReminder(
  partial: Partial<Reminder> = {},
  now: number = Date.now(),
  id: string = makeId("reminder"),
): Reminder {
  const title = safeText(partial.title, "Novo lembrete");
  return {
    id: safeText(partial.id, id, 96) || id,
    title: title || "Novo lembrete",
    notes: safeText(partial.notes, "", MAX_NOTES),
    dueAt: finiteOptionalTimestamp(partial.dueAt),
    listId: safeText(partial.listId, DEFAULT_REMINDER_LIST.id, 80) || DEFAULT_REMINDER_LIST.id,
    priority: normalizePriority(partial.priority),
    recurrence: normalizeRecurrence(partial.recurrence),
    completedAt: finiteOptionalTimestamp(partial.completedAt),
    snoozedUntil: finiteOptionalTimestamp(partial.snoozedUntil),
    lastNotifiedAt: finiteOptionalTimestamp(partial.lastNotifiedAt),
    createdAt: finiteNumber(partial.createdAt, now),
    updatedAt: finiteNumber(partial.updatedAt, now),
  };
}

export function makeTodoItem(
  partial: Partial<TodoItem> = {},
  now: number = Date.now(),
  id: string = makeId("todo"),
): TodoItem {
  const title = safeText(partial.title, "Nova tarefa");
  return {
    id: safeText(partial.id, id, 96) || id,
    title: title || "Nova tarefa",
    notes: safeText(partial.notes, "", MAX_NOTES),
    date: normalizeDateKey(partial.date, localDateKey(now)),
    dueAt: finiteOptionalTimestamp(partial.dueAt),
    completedAt: finiteOptionalTimestamp(partial.completedAt),
    order: clampInt(partial.order, 0, 999_999, 0),
    pomodorosEstimate: clampInt(partial.pomodorosEstimate, 0, 24, 0),
    linkedReminderId:
      typeof partial.linkedReminderId === "string" && partial.linkedReminderId.trim()
        ? partial.linkedReminderId.trim()
        : null,
    recurrence: normalizeTodoRecurrence(partial.recurrence),
    recurrenceWeekdays: normalizeWeekdays(partial.recurrenceWeekdays),
    snoozedUntil: finiteOptionalTimestamp(partial.snoozedUntil),
    alertDismissedAt: finiteOptionalTimestamp(partial.alertDismissedAt),
    lastNotifiedAt: finiteOptionalTimestamp(partial.lastNotifiedAt),
    createdAt: finiteNumber(partial.createdAt, now),
    updatedAt: finiteNumber(partial.updatedAt, now),
  };
}

export function normalizePomodoroSettings(value: unknown): PomodoroSettings {
  const raw = isRecord(value) ? value : {};
  return {
    focusMinutes: clampInt(raw.focusMinutes, 1, 240, DEFAULT_POMODORO_SETTINGS.focusMinutes),
    shortBreakMinutes: clampInt(
      raw.shortBreakMinutes,
      1,
      120,
      DEFAULT_POMODORO_SETTINGS.shortBreakMinutes,
    ),
    longBreakMinutes: clampInt(
      raw.longBreakMinutes,
      1,
      180,
      DEFAULT_POMODORO_SETTINGS.longBreakMinutes,
    ),
    roundsPerLongBreak: clampInt(
      raw.roundsPerLongBreak,
      1,
      12,
      DEFAULT_POMODORO_SETTINGS.roundsPerLongBreak,
    ),
    autoStartBreaks:
      typeof raw.autoStartBreaks === "boolean"
        ? raw.autoStartBreaks
        : DEFAULT_POMODORO_SETTINGS.autoStartBreaks,
    autoStartFocus:
      typeof raw.autoStartFocus === "boolean"
        ? raw.autoStartFocus
        : DEFAULT_POMODORO_SETTINGS.autoStartFocus,
  };
}

export function durationForRound(
  round: PomodoroRound,
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
): number {
  if (round === "shortBreak") return settings.shortBreakMinutes * 60;
  if (round === "longBreak") return settings.longBreakMinutes * 60;
  return settings.focusMinutes * 60;
}

export function makePomodoroTimer(
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
  partial: Partial<PomodoroTimer> = {},
): PomodoroTimer {
  const round = normalizeRound(partial.round);
  const totalSeconds = durationForRound(round, settings);
  return {
    status: normalizeStatus(partial.status),
    round,
    roundIndex: clampInt(partial.roundIndex, 0, 99_999, 0),
    startedAt: finiteOptionalTimestamp(partial.startedAt),
    pausedAt: finiteOptionalTimestamp(partial.pausedAt),
    remainingSeconds: clampInt(partial.remainingSeconds, 0, totalSeconds, totalSeconds),
    totalSeconds: clampInt(partial.totalSeconds, 1, 24 * 60 * 60, totalSeconds),
    activeTodoId:
      typeof partial.activeTodoId === "string" && partial.activeTodoId.trim()
        ? partial.activeTodoId.trim()
        : null,
  };
}

export function makeDefaultProductivityState(now: number = Date.now()): ProductivityState {
  const pomodoroSettings = { ...DEFAULT_POMODORO_SETTINGS };
  return {
    version: 1,
    lists: [{ ...DEFAULT_REMINDER_LIST }],
    reminders: [],
    todoItems: [],
    pomodoroSettings,
    pomodoroTimer: makePomodoroTimer(pomodoroSettings),
    pomodoroSessions: [],
    updatedAt: now,
  };
}

export function normalizeProductivityState(value: unknown): ProductivityState {
  const now = Date.now();
  const raw = isRecord(value) ? value : {};
  const lists = normalizeReminderLists(raw.lists);
  const pomodoroSettings = normalizePomodoroSettings(raw.pomodoroSettings);
  return {
    version: 1,
    lists,
    reminders: [],
    todoItems: normalizeTodoArray(raw.todoItems),
    pomodoroSettings,
    pomodoroTimer: makePomodoroTimer(pomodoroSettings, isRecord(raw.pomodoroTimer) ? raw.pomodoroTimer : {}),
    pomodoroSessions: normalizePomodoroSessions(raw.pomodoroSessions),
    updatedAt: finiteNumber(raw.updatedAt, now),
  };
}

function normalizeReminderLists(value: unknown): ReminderList[] {
  const raw = Array.isArray(value) ? value : [];
  const lists = raw.flatMap((entry): ReminderList[] => {
    if (!isRecord(entry)) return [];
    const id = safeText(entry.id, "", 80);
    const name = safeText(entry.name, "", 80);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        color: safeText(entry.color, DEFAULT_REMINDER_LIST.color, 24) || DEFAULT_REMINDER_LIST.color,
      },
    ];
  });
  return lists.some((list) => list.id === DEFAULT_REMINDER_LIST.id)
    ? lists
    : [{ ...DEFAULT_REMINDER_LIST }, ...lists];
}

function normalizeTodoArray(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): TodoItem[] => {
    if (!isRecord(entry)) return [];
    const id = safeText(entry.id, "", 96);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [makeTodoItem(entry as Partial<TodoItem>, Date.now(), id)];
  });
}

function normalizePomodoroSessions(value: unknown): PomodoroSession[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): PomodoroSession[] => {
    if (!isRecord(entry)) return [];
    const id = safeText(entry.id, "", 96);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const round = normalizeRound(entry.round);
    const startedAt = finiteOptionalTimestamp(entry.startedAt);
    const endedAt = finiteOptionalTimestamp(entry.endedAt);
    if (!startedAt || !endedAt) return [];
    return [
      {
        id,
        round,
        todoId: typeof entry.todoId === "string" && entry.todoId.trim() ? entry.todoId.trim() : null,
        startedAt,
        endedAt,
        durationSeconds: clampInt(entry.durationSeconds, 1, 24 * 60 * 60, durationForRound(round)),
        completed: entry.completed !== false,
      },
    ];
  });
}

export function nextReminderDueAt(reminder: Reminder): number | null {
  if (!reminder.dueAt) return null;
  if (reminder.recurrence === "none") return null;
  if (reminder.recurrence === "daily") return reminder.dueAt + MS_PER_DAY;
  if (reminder.recurrence === "weekly") return reminder.dueAt + MS_PER_DAY * 7;
  const date = new Date(reminder.dueAt);
  date.setMonth(date.getMonth() + 1);
  return date.getTime();
}

export function dueReminderAlerts(reminders: Reminder[], now: number = Date.now()): Reminder[] {
  return reminders.filter((reminder) => {
    if (reminder.completedAt || !reminder.dueAt || reminder.dueAt > now) return false;
    if (reminder.snoozedUntil && reminder.snoozedUntil > now) return false;
    const alertAt = reminder.snoozedUntil && reminder.snoozedUntil <= now
      ? reminder.snoozedUntil
      : reminder.dueAt;
    return !reminder.lastNotifiedAt || reminder.lastNotifiedAt < alertAt;
  });
}

export function dueTodoAlerts(items: TodoItem[], now: number = Date.now()): TodoItem[] {
  return items.filter((item) => shouldRepeatTodoAlert(item, now));
}

export function shouldRepeatTodoAlert(item: TodoItem, now: number = Date.now()): boolean {
  if (item.completedAt || !item.dueAt) return false;
  if (item.snoozedUntil && item.snoozedUntil > now) return false;
  const alertAt =
    item.snoozedUntil && item.snoozedUntil <= now ? item.snoozedUntil : item.dueAt;
  if (alertAt > now) return false;
  if (item.alertDismissedAt && item.alertDismissedAt >= alertAt) return false;
  if (!item.lastNotifiedAt || item.lastNotifiedAt < alertAt) return true;
  return now - item.lastNotifiedAt >= TODO_ALERT_REPEAT_MS;
}

export function todoBucketsForDate(items: TodoItem[], date: string): TodoBuckets {
  const selected = normalizeDateKey(date);
  const today = items
    .filter((item) => !item.completedAt && item.date === selected)
    .sort(compareTodoItems);
  const overdue = items
    .filter((item) => !item.completedAt && item.date < selected)
    .sort(compareTodoItems);
  return { today, overdue };
}

export function compareTodoItems(a: TodoItem, b: TodoItem): number {
  return a.order - b.order || a.createdAt - b.createdAt || a.title.localeCompare(b.title);
}

export function nextTodoOccurrence(item: TodoItem): TodoOccurrence | null {
  if (item.recurrence === "none") return null;
  const [year, month, day] = item.date.split("-").map(Number);
  const current = new Date(year, month - 1, day);
  const next =
    item.recurrence === "daily"
      ? addCalendarDays(current, 1)
      : item.recurrence === "weekly"
      ? nextWeeklyDate(current, item.recurrenceWeekdays)
      : item.recurrence === "monthly"
      ? addCalendarMonths(current, 1)
      : addCalendarYears(current, 1);

  return {
    date: localDateKey(next.getTime()),
    dueAt: item.dueAt ? applyTimeToDate(next, new Date(item.dueAt)) : null,
  };
}

function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addCalendarMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  target.setDate(Math.min(date.getDate(), daysInMonth(target.getFullYear(), target.getMonth())));
  return target;
}

function addCalendarYears(date: Date, years: number): Date {
  const target = new Date(date.getFullYear() + years, date.getMonth(), 1);
  target.setDate(Math.min(date.getDate(), daysInMonth(target.getFullYear(), target.getMonth())));
  return target;
}

function nextWeeklyDate(date: Date, weekdays: number[]): Date {
  const selected = weekdays.length ? weekdays : [date.getDay()];
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addCalendarDays(date, offset);
    if (selected.includes(candidate.getDay())) return candidate;
  }
  return addCalendarDays(date, 7);
}

function daysInMonth(year: number, zeroBasedMonth: number): number {
  return new Date(year, zeroBasedMonth + 1, 0).getDate();
}

function applyTimeToDate(date: Date, timeSource: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    timeSource.getHours(),
    timeSource.getMinutes(),
    timeSource.getSeconds(),
    0,
  ).getTime();
}

export function startPomodoroTimer(
  timer: PomodoroTimer,
  settings: PomodoroSettings,
  now: number = Date.now(),
  activeTodoId: string | null = timer.activeTodoId,
): PomodoroTimer {
  if (timer.status === "running") return timer;
  const total = durationForRound(timer.round, settings);
  const remaining =
    timer.status === "paused" ? Math.max(0, timer.remainingSeconds) : total;
  return {
    ...timer,
    status: "running",
    startedAt: now,
    pausedAt: null,
    remainingSeconds: remaining,
    totalSeconds: total,
    activeTodoId,
  };
}

export function pausePomodoroTimer(
  timer: PomodoroTimer,
  now: number = Date.now(),
): PomodoroTimer {
  if (timer.status !== "running" || !timer.startedAt) return timer;
  const elapsed = Math.max(0, Math.floor((now - timer.startedAt) / 1000));
  return {
    ...timer,
    status: "paused",
    startedAt: null,
    pausedAt: now,
    remainingSeconds: Math.max(0, timer.remainingSeconds - elapsed),
  };
}

export function resumePomodoroTimer(
  timer: PomodoroTimer,
  now: number = Date.now(),
): PomodoroTimer {
  if (timer.status !== "paused") return timer;
  return {
    ...timer,
    status: "running",
    startedAt: now,
    pausedAt: null,
  };
}

export function resetPomodoroTimer(
  timer: PomodoroTimer,
  settings: PomodoroSettings,
): PomodoroTimer {
  const total = durationForRound(timer.round, settings);
  return {
    ...timer,
    status: "idle",
    startedAt: null,
    pausedAt: null,
    remainingSeconds: total,
    totalSeconds: total,
  };
}

export function completePomodoroRound(
  timer: PomodoroTimer,
  settings: PomodoroSettings,
  now: number = Date.now(),
): PomodoroCompletion {
  const startedAt =
    timer.startedAt ?? Math.max(0, now - timer.totalSeconds * 1000);
  const durationSeconds = Math.max(1, Math.floor((now - startedAt) / 1000));
  const session: PomodoroSession = {
    id: makeId("pomo-session"),
    round: timer.round,
    todoId: timer.activeTodoId,
    startedAt,
    endedAt: now,
    durationSeconds,
    completed: true,
  };
  const completedFocusRounds =
    timer.round === "focus" ? timer.roundIndex + 1 : timer.roundIndex;
  const nextRound = nextPomodoroRound(timer.round, completedFocusRounds, settings);
  const total = durationForRound(nextRound, settings);
  return {
    session,
    timer: {
      status:
        nextRound === "focus"
          ? settings.autoStartFocus
            ? "running"
            : "idle"
          : settings.autoStartBreaks
          ? "running"
          : "idle",
      round: nextRound,
      roundIndex: completedFocusRounds,
      startedAt:
        (nextRound === "focus" && settings.autoStartFocus) ||
        (nextRound !== "focus" && settings.autoStartBreaks)
          ? now
          : null,
      pausedAt: null,
      remainingSeconds: total,
      totalSeconds: total,
      activeTodoId: timer.activeTodoId,
    },
  };
}

export function nextPomodoroRound(
  current: PomodoroRound,
  completedFocusRounds: number,
  settings: PomodoroSettings,
): PomodoroRound {
  if (current !== "focus") return "focus";
  return completedFocusRounds > 0 &&
    completedFocusRounds % settings.roundsPerLongBreak === 0
    ? "longBreak"
    : "shortBreak";
}

export function pomodoroRemainingSeconds(
  timer: PomodoroTimer,
  now: number = Date.now(),
): number {
  if (timer.status !== "running" || !timer.startedAt) return timer.remainingSeconds;
  const elapsed = Math.max(0, Math.floor((now - timer.startedAt) / 1000));
  return Math.max(0, timer.remainingSeconds - elapsed);
}

export function exportRemindersToIcs(reminders: Reminder[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Snapbar//Productivity//PT-BR"];
  for (const reminder of reminders) {
    if (!reminder.dueAt || reminder.completedAt) continue;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcs(reminder.id)}@snapbar`);
    lines.push(`SUMMARY:${escapeIcs(reminder.title)}`);
    if (reminder.notes) lines.push(`DESCRIPTION:${escapeIcs(reminder.notes)}`);
    lines.push(`DTSTART:${formatIcsUtc(reminder.dueAt)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function formatIcsUtc(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function getProductivityState(): Promise<ProductivityState> {
  return normalizeProductivityState(await invoke("productivity_get_state"));
}

export async function saveProductivityState(
  state: ProductivityState,
): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("productivity_save_state", { state }),
  );
}

export async function upsertReminder(reminder: Reminder): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("productivity_upsert_reminder", { reminder }),
  );
}

export async function completeReminder(
  reminderId: string,
): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("productivity_complete_reminder", { reminderId }),
  );
}

export async function snoozeReminder(
  reminderId: string,
  minutes: number,
): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("productivity_snooze_reminder", { reminderId, minutes }),
  );
}

export async function deleteReminder(reminderId: string): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("productivity_delete_reminder", { reminderId }),
  );
}

export async function upsertTodoItem(item: TodoItem): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("productivity_upsert_todo", { item }),
  );
}

export async function completeTodoItem(todoId: string): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("productivity_complete_todo", { todoId }),
  );
}

export async function snoozeTodoAlert(
  todoId: string,
  minutes: number,
): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("productivity_snooze_todo", { todoId, minutes }),
  );
}

export async function dismissTodoAlert(todoId: string): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("productivity_dismiss_todo_alert", { todoId }),
  );
}

export async function deleteTodoItem(todoId: string): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("productivity_delete_todo", { todoId }),
  );
}

export async function startPomodoro(activeTodoId?: string | null): Promise<ProductivityState> {
  return normalizeProductivityState(
    await invoke("pomodoro_start_timer", { activeTodoId: activeTodoId ?? null }),
  );
}

export async function pausePomodoro(): Promise<ProductivityState> {
  return normalizeProductivityState(await invoke("pomodoro_pause_timer"));
}

export async function resumePomodoro(): Promise<ProductivityState> {
  return normalizeProductivityState(await invoke("pomodoro_resume_timer"));
}

export async function resetPomodoro(): Promise<ProductivityState> {
  return normalizeProductivityState(await invoke("pomodoro_reset_timer"));
}

export async function skipPomodoroRound(): Promise<ProductivityState> {
  return normalizeProductivityState(await invoke("pomodoro_skip_round"));
}
