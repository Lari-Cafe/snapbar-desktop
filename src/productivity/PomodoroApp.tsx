import { useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Pause,
  Play,
  RotateCcw,
  Settings2,
  TimerReset,
} from "lucide-react";
import Counter from "../components/Counter";
import ProductivityFrame from "./ProductivityFrame";
import { stopPomodoroAlarm } from "./productivity-alert-sound";
import { useProductivityState } from "./useProductivityState";
import {
  PRODUCTIVITY_EVENTS,
  durationForRound,
  pausePomodoro,
  resetPomodoro,
  resumePomodoro,
  saveProductivityState,
  startPomodoro,
  type PomodoroRound,
  type PomodoroSettings,
  type PomodoroStatus,
  type ProductivityState,
} from "../lib/productivity";
import { userFacingError } from "../lib/user-facing-errors";

interface TickPayload {
  remainingSeconds: number;
  totalSeconds: number;
  round: PomodoroRound;
  status: PomodoroStatus;
}

type NumericPomodoroSetting =
  | "focusMinutes"
  | "shortBreakMinutes"
  | "longBreakMinutes"
  | "roundsPerLongBreak";

type DraftSettings = Record<NumericPomodoroSetting, string>;

const RING_RADIUS = 88;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const LIMITS: Record<NumericPomodoroSetting, [number, number]> = {
  focusMinutes: [1, 240],
  shortBreakMinutes: [1, 120],
  longBreakMinutes: [1, 180],
  roundsPerLongBreak: [1, 12],
};

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function roundLabel(round: PomodoroRound): string {
  if (round === "shortBreak") return "Pausa curta";
  if (round === "longBreak") return "Pausa longa";
  return "Foco";
}

function statusLabel(status: PomodoroStatus | undefined): string {
  if (status === "running") return "Rodando";
  if (status === "paused") return "Pausado";
  return "Pronto";
}

function nextRoundLabel(round: PomodoroRound, roundIndex: number, cycles: number): string {
  if (round !== "focus") return "Foco";
  return (roundIndex + 1) % cycles === 0 ? "Pausa longa" : "Pausa curta";
}

function draftFromSettings(settings: PomodoroSettings): DraftSettings {
  return {
    focusMinutes: String(settings.focusMinutes),
    shortBreakMinutes: String(settings.shortBreakMinutes),
    longBreakMinutes: String(settings.longBreakMinutes),
    roundsPerLongBreak: String(settings.roundsPerLongBreak),
  };
}

function clampSetting(key: NumericPomodoroSetting, value: string): number {
  const [min, max] = LIMITS[key];
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function sanitizedSettings(
  settings: PomodoroSettings,
  draft: DraftSettings,
): PomodoroSettings {
  return {
    ...settings,
    focusMinutes: clampSetting("focusMinutes", draft.focusMinutes),
    shortBreakMinutes: clampSetting("shortBreakMinutes", draft.shortBreakMinutes),
    longBreakMinutes: clampSetting("longBreakMinutes", draft.longBreakMinutes),
    roundsPerLongBreak: clampSetting("roundsPerLongBreak", draft.roundsPerLongBreak),
  };
}

function stopAlarm() {
  stopPomodoroAlarm();
  emit("productivity://stop-pomodoro-alarm").catch(() => {});
}

export default function PomodoroApp() {
  const { state, feedback, setFeedback, applyState } = useProductivityState();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<DraftSettings | null>(null);

  const timer = state?.pomodoroTimer;
  const settings = state?.pomodoroSettings;
  const currentRound = timer?.round ?? "focus";
  const total = timer?.totalSeconds ?? (settings?.focusMinutes ?? 25) * 60;
  const visibleRemaining = remaining ?? timer?.remainingSeconds ?? total;
  const clockText = formatClock(visibleRemaining);
  const clockMinutes = Math.floor(visibleRemaining / 60);
  const clockSeconds = visibleRemaining % 60;
  const clockLengthClass =
    clockText.length >= 7 ? " compact" : clockText.length >= 5 ? " medium" : "";
  const clockFontSize = clockText.length >= 7 ? 30 : clockText.length >= 5 ? 36 : 44;
  const progress = total > 0 ? Math.max(0, Math.min(1, 1 - visibleRemaining / total)) : 0;
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);
  const cycles = Math.max(1, settings?.roundsPerLongBreak ?? 4);
  const completedFocusRounds = timer?.roundIndex ?? 0;
  const roundNumber =
    currentRound === "focus"
      ? (completedFocusRounds % cycles) + 1
      : Math.max(1, completedFocusRounds % cycles || cycles);
  const roundCountText = `${roundNumber}/${cycles}`;
  const primaryLabel =
    timer?.status === "running" ? "Pausar" : timer?.status === "paused" ? "Retomar" : "Iniciar";

  const fields = useMemo(
    () => [
      { key: "focusMinutes" as const, label: "Foco", suffix: "min" },
      { key: "shortBreakMinutes" as const, label: "Pausa curta", suffix: "min" },
      { key: "longBreakMinutes" as const, label: "Pausa longa", suffix: "min" },
      { key: "roundsPerLongBreak" as const, label: "Ciclos", suffix: "ate longa" },
    ],
    [],
  );

  useEffect(() => {
    if (settings) setDraft(draftFromSettings(settings));
  }, [settings]);

  useEffect(() => {
    setRemaining(timer?.remainingSeconds ?? null);
  }, [timer?.remainingSeconds, timer?.round, timer?.status]);

  useEffect(() => {
    let unlistenTick: (() => void) | null = null;
    let unlistenRoundComplete: (() => void) | null = null;
    (async () => {
      unlistenTick = await listen<TickPayload>(
        PRODUCTIVITY_EVENTS.pomodoroTick,
        (event) => setRemaining(event.payload.remainingSeconds),
      );
      unlistenRoundComplete = await listen(
        PRODUCTIVITY_EVENTS.pomodoroRoundComplete,
        () => {
          setSettingsOpen(false);
          setFeedback("Ciclo concluido");
        },
      );
    })();
    return () => {
      if (unlistenTick) unlistenTick();
      if (unlistenRoundComplete) unlistenRoundComplete();
    };
  }, [setFeedback]);

  useEffect(() => {
    let unlistenFocus: (() => void) | null = null;
    const stopOnFocus = () => stopAlarm();
    const stopOnVisible = () => {
      if (!document.hidden) stopAlarm();
    };
    window.addEventListener("focus", stopOnFocus);
    document.addEventListener("visibilitychange", stopOnVisible);
    (async () => {
      try {
        unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) stopAlarm();
        });
      } catch {
        // Browser dev preview does not expose Tauri window APIs.
      }
    })();
    return () => {
      window.removeEventListener("focus", stopOnFocus);
      document.removeEventListener("visibilitychange", stopOnVisible);
      if (unlistenFocus) unlistenFocus();
    };
  }, []);

  const run = async (task: Promise<ProductivityState>, ok: string, fallback: string) => {
    try {
      const next = await task;
      applyState(next);
      setFeedback(ok);
    } catch (err) {
      setFeedback(userFacingError(err, fallback));
    }
  };

  const toggle = () => {
    stopAlarm();
    if (!timer || timer.status === "idle") {
      void run(startPomodoro(null), "Pomodoro iniciado", "Nao foi possivel iniciar.");
      return;
    }
    if (timer.status === "running") {
      void run(pausePomodoro(), "Pomodoro pausado", "Nao foi possivel pausar.");
      return;
    }
    void run(resumePomodoro(), "Pomodoro retomado", "Nao foi possivel retomar.");
  };

  const reset = () => {
    stopAlarm();
    void run(resetPomodoro(), "Pomodoro resetado", "Nao foi possivel resetar.");
  };

  const applySettings = async () => {
    if (!state || !settings || !draft) return;
    const nextSettings = sanitizedSettings(settings, draft);
    const round = state.pomodoroTimer.round;
    const nextTotal = durationForRound(round, nextSettings);
    const nextState: ProductivityState = {
      ...state,
      pomodoroSettings: nextSettings,
      pomodoroTimer:
        state.pomodoroTimer.status === "running"
          ? state.pomodoroTimer
          : {
              ...state.pomodoroTimer,
              totalSeconds: nextTotal,
              remainingSeconds: nextTotal,
            },
    };
    await run(
      saveProductivityState(nextState),
      "Configuracao salva",
      "Nao foi possivel salvar configuracao.",
    );
    setSettingsOpen(false);
  };

  return (
    <ProductivityFrame
      title="Pomodoro"
      subtitle={`${roundLabel(currentRound)} • ${statusLabel(timer?.status)}`}
      Icon={TimerReset}
      className={`productivity-pomodoro${settingsOpen ? " settings-open" : ""}`}
      actions={
        <button
          className={`productivity-icon-button${settingsOpen ? " active" : ""}`}
          type="button"
          title="Configurar"
          aria-label="Configurar"
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <Settings2 size={16} strokeWidth={2.3} absoluteStrokeWidth />
        </button>
      }
      windowSize={{
        width: 520,
        height: 300,
        minWidth: 520,
        minHeight: 300,
        aspectRatio: 520 / 300,
        lockVerticalResize: true,
        resizable: true,
        persistKey: "pomodoro-horizontal-v6",
      }}
    >
      <section className="productivity-content pomodoro-minimal-layout pomodoro-horizontal-layout">
        <div className="pomodoro-timer-surface">
          <div className="pomodoro-ring-shell" aria-label={`${Math.round(progress * 100)}%`}>
            <svg className="pomodoro-progress-ring" viewBox="0 0 220 220" aria-hidden="true">
              <circle className="pomodoro-progress-track" cx="110" cy="110" r={RING_RADIUS} />
              <circle
                className="pomodoro-progress-value"
                cx="110"
                cy="110"
                r={RING_RADIUS}
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="pomodoro-time-stack">
              <span className="pomodoro-round-pill">{roundLabel(currentRound)}</span>
              <span
                className="pomodoro-round-count"
                aria-label={`Ciclo ${roundNumber} de ${cycles}`}
                data-round-count={roundCountText}
              >
                {roundCountText}
              </span>
              <strong className={`productivity-clock${clockLengthClass}`} aria-label={clockText}>
                <Counter value={clockMinutes} fontSize={clockFontSize} fontWeight="860" />
                <span className="pomodoro-clock-separator">:</span>
                <Counter
                  value={clockSeconds}
                  fontSize={clockFontSize}
                  fontWeight="860"
                  minDigits={2}
                />
              </strong>
              <small>{statusLabel(timer?.status)}</small>
            </div>
          </div>

          <div className="pomodoro-side-panel">
            {settingsOpen && draft ? (
              <aside className="pomodoro-settings-drawer" aria-label="Configuracoes do Pomodoro">
                <div className="pomodoro-drawer-head">
                  <strong>Configurar</strong>
                  <span>Digite os tempos</span>
                </div>
                <div className="pomodoro-field-grid">
                  {fields.map((field) => (
                    <label className="pomodoro-number-field" key={field.key}>
                      <span>{field.label}</span>
                      <div>
                        <input
                          type="number"
                          min={LIMITS[field.key][0]}
                          max={LIMITS[field.key][1]}
                          value={draft[field.key]}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...(current ?? draft),
                              [field.key]: event.target.value,
                            }))
                          }
                        />
                        <small>{field.suffix}</small>
                      </div>
                    </label>
                  ))}
                </div>
                <button
                  className="productivity-command primary pomodoro-apply"
                  type="button"
                  onClick={() => void applySettings()}
                >
                  Aplicar
                </button>
              </aside>
            ) : (
              <div className="pomodoro-action-panel">
                <div className="pomodoro-next-line">
                  Proximo: {nextRoundLabel(currentRound, timer?.roundIndex ?? 0, cycles)}
                </div>

                <div className="pomodoro-controls">
                  <button
                    className="productivity-command primary pomodoro-primary"
                    type="button"
                    onClick={toggle}
                  >
                    {timer?.status === "running" ? (
                      <Pause size={16} strokeWidth={2.5} absoluteStrokeWidth />
                    ) : (
                      <Play size={16} strokeWidth={2.5} absoluteStrokeWidth />
                    )}
                    {primaryLabel}
                  </button>
                  <button
                    className="productivity-icon-button pomodoro-reset"
                    type="button"
                    title="Resetar"
                    aria-label="Resetar"
                    onClick={reset}
                  >
                    <RotateCcw size={16} strokeWidth={2.3} absoluteStrokeWidth />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      {feedback ? <div className="productivity-toast">{feedback}</div> : null}
    </ProductivityFrame>
  );
}
