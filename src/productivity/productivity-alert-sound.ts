type ProductivityAlarmKind = "todo" | "pomodoro";

const TODO_ALARM_MS = 120_000;
const POMODORO_ALARM_MS = 4_000;
const POMODORO_GAIN_BOOST_DB = 10;
const POMODORO_GAIN_MULTIPLIER = 10 ** (POMODORO_GAIN_BOOST_DB / 20);

interface ActiveAlarm {
  interval: number;
  timeout: number;
}

const activeAlarms = new Map<ProductivityAlarmKind, ActiveAlarm>();

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    audioContext ??= new AudioContext();
    return audioContext;
  } catch {
    return null;
  }
}

function tone(
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  gainValue: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function pomodoroGain(value: number): number {
  return Math.min(0.35, value * POMODORO_GAIN_MULTIPLIER);
}

export function playProductivityTone(kind: ProductivityAlarmKind) {
  const context = getAudioContext();
  if (!context) return;
  const now = context.currentTime;
  if (kind === "pomodoro") {
    tone(context, 720, now, 0.16, pomodoroGain(0.09));
    tone(context, 960, now + 0.18, 0.18, pomodoroGain(0.075));
    return;
  }
  tone(context, 520, now, 0.12, 0.075);
  tone(context, 680, now + 0.13, 0.12, 0.065);
}

export function startProductivityAlarm(kind: ProductivityAlarmKind) {
  stopProductivityAlarm(kind);
  playProductivityTone(kind);
  const startedAt = Date.now();
  const maxAlarmMs = kind === "pomodoro" ? POMODORO_ALARM_MS : TODO_ALARM_MS;
  const interval = window.setInterval(() => {
    if (Date.now() - startedAt >= maxAlarmMs) {
      stopProductivityAlarm(kind);
      return;
    }
    playProductivityTone(kind);
  }, kind === "pomodoro" ? 1150 : 2400);
  const timeout = window.setTimeout(() => stopProductivityAlarm(kind), maxAlarmMs);
  activeAlarms.set(kind, { interval, timeout });
}

export function stopProductivityAlarm(kind?: ProductivityAlarmKind) {
  const kinds: ProductivityAlarmKind[] = kind ? [kind] : ["todo", "pomodoro"];
  for (const entry of kinds) {
    const alarm = activeAlarms.get(entry);
    if (alarm) {
      window.clearInterval(alarm.interval);
      window.clearTimeout(alarm.timeout);
      activeAlarms.delete(entry);
    }
  }
}

export function stopPomodoroAlarm() {
  stopProductivityAlarm("pomodoro");
}
