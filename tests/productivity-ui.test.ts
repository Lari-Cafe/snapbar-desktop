import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function ruleBody(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("productivity tools UI integration", () => {
  it("registers Typo Fire, calendar, pomodoro and alert as separate routes", () => {
    const main = readProjectFile("src/main.tsx");

    expect(main).toContain("#/typo-fire");
    expect(main).toContain("#/todo-calendar");
    expect(main).toContain("#/pomodoro");
    expect(main).toContain("#/productivity-alert");
    expect(main).toContain("TypoFireApp");
    expect(main).toContain("TodoCalendarApp");
    expect(main).toContain("PomodoroApp");
    expect(main).toContain("ProductivityAlertApp");
    expect(main).not.toContain("#/reminders");
    expect(main).not.toContain("RemindersApp");
  });

  it("keeps floating toolbar actions explicit and removes the visual shortcuts button", () => {
    const app = readProjectFile("src/App.tsx");
    const toolbarActions = readProjectFile("src/lib/toolbar-actions.ts");

    for (const id of [
      "record",
      "dictate",
      "download",
      "mixer",
      "todoCalendar",
      "pomodoro",
      "notes",
      "capture",
      "typoFire",
      "system",
    ]) {
      expect(toolbarActions).toContain(`id: "${id}"`);
    }

    expect(toolbarActions).not.toContain('id: "shortcut"');
    expect(app).toContain('id === "close"');
    expect(app).toContain("open_typo_fire_window");
    expect(app).toContain("open_todo_calendar_window");
    expect(app).toContain("open_pomodoro_window");
  });

  it("keeps calendar and pomodoro in separate component files", () => {
    const calendar = readProjectFile("src/productivity/TodoCalendarApp.tsx");
    const pomodoro = readProjectFile("src/productivity/PomodoroApp.tsx");
    const alert = readProjectFile("src/productivity/ProductivityAlertApp.tsx");

    expect(calendar).toContain("To-do Calendar");
    expect(pomodoro).toContain("Pomodoro");
    expect(alert).toContain("Lembrete");
    expect(calendar).not.toContain("function PomodoroApp");
    expect(pomodoro).not.toContain("function TodoCalendarApp");
    expect(alert).not.toContain("function TodoCalendarApp");
  });

  it("keeps Todo Calendar free of Pomodoro estimate UI while accepting legacy data elsewhere", () => {
    const calendar = readProjectFile("src/productivity/TodoCalendarApp.tsx");
    const domain = readProjectFile("src/lib/productivity.ts");

    expect(calendar).toContain("productivity-calendar-layout");
    expect(calendar).toContain("RECURRENCE_OPTIONS");
    expect(calendar).toContain("shiftDateKeyMonth");
    expect(calendar).toContain("preferredMonthDay");
    expect(calendar).toContain("Clock3");
    expect(calendar).toContain('type="time"');
    expect(calendar).toContain("dueTime");
    expect(calendar).not.toContain("calendar-estimate-stepper");
    expect(calendar).not.toContain("pomodorosEstimate");
    expect(calendar).not.toContain("pomodoro-linked-task");
    expect(calendar).not.toContain("pomodoro-task-row");
    expect(calendar).not.toContain("<select");
    expect(domain).toContain("pomodorosEstimate");
  });

  it("rebuilds Pomodoro as a minimal timer without presets, stats or task coupling", () => {
    const pomodoro = readProjectFile("src/productivity/PomodoroApp.tsx");
    const counter = readProjectFile("src/components/Counter.tsx");

    expect(pomodoro).toContain("pomodoro-progress-ring");
    expect(pomodoro).toContain("pomodoro-progress-value");
    expect(pomodoro).toContain("strokeDashoffset");
    expect(pomodoro).toContain("pomodoro-settings-drawer");
    expect(pomodoro).toContain("type=\"number\"");
    expect(pomodoro).toContain("durationForRound");
    expect(pomodoro).toContain("roundsPerLongBreak");
    expect(pomodoro).toContain("resizable: true");
    expect(pomodoro).toContain("pomodoro-horizontal-v6");
    expect(pomodoro).toContain("aspectRatio: 520 / 300");
    expect(pomodoro).toContain("lockVerticalResize: true");
    expect(pomodoro).toContain("pomodoro-horizontal-layout");
    expect(pomodoro).toContain("pomodoro-side-panel");
    expect(pomodoro).toContain("roundNumber");
    expect(pomodoro).toContain("roundCountText");
    expect(pomodoro).toContain("pomodoro-round-count");
    expect(pomodoro).toContain('import Counter from "../components/Counter"');
    expect(pomodoro).toContain("const clockMinutes = Math.floor(visibleRemaining / 60)");
    expect(pomodoro).toContain("const clockSeconds = visibleRemaining % 60");
    expect(pomodoro).toContain("<Counter value={clockMinutes}");
    expect(pomodoro).toContain("value={clockSeconds}");
    expect(pomodoro).toContain('className="pomodoro-clock-separator"');
    expect(pomodoro).toContain("minDigits={2}");
    expect(pomodoro).not.toContain("<Counter value={roundNumber}");
    expect(pomodoro).not.toContain("<Counter value={cycles}");
    expect(pomodoro).toContain('aria-label={`Ciclo ${roundNumber} de ${cycles}`}');
    expect(pomodoro).toContain("width: 520");
    expect(pomodoro).toContain("clockLengthClass");
    expect(pomodoro).toContain(
      "const clockFontSize = clockText.length >= 7 ? 30 : clockText.length >= 5 ? 36 : 44;",
    );
    expect(pomodoro).toContain("timer?.remainingSeconds ?? total");
    expect(pomodoro).toContain("stopPomodoroAlarm");
    expect(pomodoro).toContain("productivity://stop-pomodoro-alarm");
    expect(pomodoro).toContain("onFocusChanged");
    expect(pomodoro).not.toContain("ROUND_OPTIONS");
    expect(pomodoro).not.toContain("pomodoro-phase-tabs");
    expect(pomodoro).not.toContain("pomodoro-bottom-tabs");
    expect(pomodoro).not.toContain("pomodoro-stats-grid");
    expect(pomodoro).not.toContain("pomodoro-toggle-list");
    expect(pomodoro).not.toContain("pomodoro-round-overlay");
    expect(pomodoro).not.toContain("Estatisticas");
    expect(pomodoro).not.toContain("skipPomodoroRound");
    expect(pomodoro).not.toContain("pomodoro-linked-task");
    expect(pomodoro).not.toContain("pomodoro-task-row");
    expect(pomodoro).not.toContain("<select");
    expect(counter).toContain("useReducedMotion");
    expect(counter).toContain("animatedValue.jump(valueRoundedToPlace)");
    expect(counter).toContain("minDigits = 1");
  });

  it("styles productivity with glass motion, dedicated drag strip and rounded timer ring", () => {
    const css = readProjectFile("src/productivity/Productivity.css");
    const designSystem = readProjectFile("src/styles/design-system.css");
    const frame = readProjectFile("src/productivity/ProductivityFrame.tsx");
    const sound = readProjectFile("src/productivity/productivity-alert-sound.ts");

    expect(css).toContain("--snap-ease: cubic-bezier(0.22, 1, 0.36, 1)");
    expect(css).toContain("--snap-slow: 450ms");
    expect(css).toContain(".productivity-window.phase-opening");
    expect(css).toContain(".productivity-window.phase-expanding");
    expect(css).toContain(".productivity-window.phase-collapsing");
    expect(css).toContain(".productivity-drag-strip");
    expect(css).toContain(".pomodoro-progress-value");
    expect(css).toContain("stroke-linecap: round");
    expect(css).toContain(".pomodoro-settings-drawer");
    expect(css).toContain(".pomodoro-horizontal-layout");
    expect(css).toContain("productivity-pomodoro-open");
    expect(css).toContain("--pomodoro-ring-size");
    expect(css).toContain(".pomodoro-side-panel");
    expect(css).toContain(".calendar-selected-head > div");
    expect(css).toContain(".calendar-repeat-control button {");
    expect(css).toContain("justify-content: center;");
    expect(css).toContain("line-height: 1;");
    expect(css).toContain(".pomodoro-action-panel");
    expect(css).toContain(".pomodoro-round-count");
    expect(css).toContain(".pomodoro-time-stack {");
    expect(ruleBody(css, ".pomodoro-time-stack")).toContain("gap: 3px");
    expect(ruleBody(css, ".pomodoro-round-pill")).toContain("min-height: 18px");
    expect(ruleBody(css, ".pomodoro-round-count")).toContain("height: 18px");
    expect(css).toContain("color: rgba(31, 35, 41, 0.72)");
    expect(css).toContain("background: rgba(31, 35, 41, 0.06)");
    expect(css).toContain("grid-template-rows: auto auto minmax(0, 1fr)");
    expect(css).toContain("grid-template-rows: repeat(6, minmax(34px, 1fr))");
    expect(css).toContain("body.theme-liquid-glass .productivity-pomodoro .pomodoro-timer-surface");
    expect(css).toContain("body.theme-liquid-glass .productivity-pomodoro .productivity-titlebar");
    expect(css).toContain("body.theme-liquid-glass .productivity-pomodoro .pomodoro-time-stack");
    expect(css).toContain("body.theme-liquid-glass .productivity-pomodoro .pomodoro-round-count");
    expect(css).toContain("color: rgba(248, 250, 252, 0.92) !important");
    expect(css).toContain("body.theme-liquid-glass .productivity-calendar .calendar-month-panel");
    expect(css).toContain("body.theme-liquid-glass .productivity-calendar .calendar-agenda-panel");
    expect(css).toContain("body.theme-liquid-glass .productivity-calendar .productivity-day.active");
    expect(css).toContain("body.theme-liquid-glass .productivity-alert-card");
    expect(css).toContain("body.theme-liquid-glass .productivity-alert-actions");
    expect(css).toContain("body.theme-liquid-glass .productivity-alert-icon");
    expect(css).toContain("body.theme-liquid-glass .productivity-brand-icon");
    expect(designSystem).toContain("body.theme-liquid-glass {");
    expect(designSystem).toContain("--snap-feature-text: rgba(248, 250, 252, 0.94)");
    expect(css).toContain(".productivity-clock.medium");
    expect(css).toContain(".productivity-clock.compact");
    expect(css).toContain('grid-template-areas:');
    expect(css).toContain('"ring side"');
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) 40px");
    expect(css).toContain("width: 100%");
    expect(css).toContain("@media (max-width: 460px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toContain("--pomodoro-ring-size: 126px");
    expect(css).not.toContain(".pomodoro-phase-tabs");
    expect(css).not.toContain(".pomodoro-bottom-tabs");
    expect(css).not.toContain(".pomodoro-stats-grid");
    expect(css).not.toContain(".calendar-estimate-stepper");
    expect(frame).toContain("productivity-drag-strip");
    expect(frame).toContain("data-tauri-drag-region");
    expect(frame).toContain("LazyStore");
    expect(frame).toContain("setResizable");
    expect(frame).toContain("setMinSize");
    expect(frame).toContain("normalizeAspectWindow");
    expect(frame).toContain("enforceAspectRatio");
    expect(frame).toContain("verticalOnlyResize");
    expect(frame).toContain("onResized");
    expect(frame).toContain("PRODUCTIVITY_WINDOW_KEY_PREFIX");
    expect(sound).toContain('type ProductivityAlarmKind = "todo" | "pomodoro"');
    expect(sound).toContain("TODO_ALARM_MS = 120_000");
    expect(sound).toContain("POMODORO_ALARM_MS = 4_000");
    expect(sound).toContain("POMODORO_GAIN_BOOST_DB = 10");
    expect(sound).toContain("stopPomodoroAlarm");
  });

  it("keeps the Liquid Glass alert host transparent", () => {
    const css = readProjectFile("src/productivity/Productivity.css");
    const alertHost = ruleBody(
      css,
      "body.theme-liquid-glass .productivity-alert-window",
    );

    expect(alertHost).toContain("background: transparent !important");
    expect(alertHost).toContain("border: 0 !important");
    expect(alertHost).toContain("box-shadow: none !important");
    expect(alertHost).toContain("backdrop-filter: none !important");
    expect(alertHost).toContain("-webkit-backdrop-filter: none !important");
  });

  it("exposes productivity shortcuts and native permissions", () => {
    const settings = readProjectFile("src/lib/app-settings.ts");
    const lib = readProjectFile("src-tauri/src/lib.rs");
    const capability = readProjectFile("src-tauri/capabilities/default.json");

    expect(settings).not.toContain('"open_reminders"');
    expect(settings).toContain('"open_todo_calendar"');
    expect(settings).toContain('"open_pomodoro"');
    expect(settings).toContain('"pomodoro_start_pause"');
    expect(settings).not.toContain('"quick_add_reminder"');
    expect(settings).toContain('"quick_add_todo"');
    expect(lib).toContain("tauri_plugin_notification::init()");
    expect(capability).not.toContain('"reminders"');
    expect(capability).toContain('"todo-calendar"');
    expect(capability).toContain('"pomodoro"');
    expect(capability).toContain('"productivity-alert"');
    expect(capability).toContain('"typo-fire"');
    expect(capability).toContain('"notification:default"');
    expect(capability).toContain('"core:window:allow-set-resizable"');
  });

  it("uses adaptive window geometry helpers for productivity windows", () => {
    const helper = readProjectFile("src/lib/adaptive-window-geometry.ts");
    const frame = readProjectFile("src/productivity/ProductivityFrame.tsx");
    const alert = readProjectFile("src/productivity/ProductivityAlertApp.tsx");

    expect(helper).toContain("computePosition");
    expect(helper).toContain("flip(");
    expect(helper).toContain("shift(");
    expect(helper).toContain("size(");
    expect(helper).toContain('anchor === "center"');
    expect(helper).toContain("animateWindowGeometry");
    expect(helper).toContain("preservePosition?: boolean");
    expect(helper).toContain("if (options.preservePosition)");
    expect(frame).toContain("fitCurrentWindowToViewport");
    expect(frame).toContain('setPhase("expanding")');
    expect(frame).toContain('setPhase("collapsing")');
    expect(frame).toContain("preservePosition: previousArea !== null");
    expect(alert).toContain("fitCurrentWindowToViewport");
  });
});
