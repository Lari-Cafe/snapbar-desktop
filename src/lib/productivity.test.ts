import { describe, expect, it } from "vitest";
import {
  DEFAULT_POMODORO_SETTINGS,
  PRODUCTIVITY_ANIMATION_MS,
  PRODUCTIVITY_CARD_STAGGER_MS,
  completePomodoroRound,
  dueTodoAlerts,
  makePomodoroTimer,
  makeTodoItem,
  nextTodoOccurrence,
  normalizeProductivityState,
  pausePomodoroTimer,
  resumePomodoroTimer,
  shouldRepeatTodoAlert,
  startPomodoroTimer,
  shiftDateKeyMonth,
  todoBucketsForDate,
} from "./productivity";

describe("productivity domain helpers", () => {
  it("normalizes todos and clears legacy reminders from active state", () => {
    const state = normalizeProductivityState({
      reminders: [
        {
          id: "r1",
          title: "  Beber agua  ",
          dueAt: 1_700_000_000_000,
          priority: "high",
          recurrence: "daily",
        },
        { id: "", title: "invalid" },
      ],
      todoItems: [
        {
          id: "t1",
          title: "  Revisar build  ",
          date: "2026-06-06",
          order: 7,
          pomodorosEstimate: 3,
          recurrence: "weekly",
          recurrenceWeekdays: [1, 3, 3, 9],
        },
      ],
      pomodoroSettings: {
        focusMinutes: 50,
        shortBreakMinutes: 10,
        longBreakMinutes: 25,
        roundsPerLongBreak: 3,
      },
    });

    expect(state.version).toBe(1);
    expect(state.reminders).toEqual([]);
    expect(state.todoItems[0]).toMatchObject({
      id: "t1",
      title: "Revisar build",
      date: "2026-06-06",
      order: 7,
      pomodorosEstimate: 3,
      recurrence: "weekly",
      recurrenceWeekdays: [1, 3],
    });
    expect(state.pomodoroSettings.focusMinutes).toBe(50);
  });

  it("preserves a zero Unix timestamp in todo creation and persisted state", () => {
    expect(makeTodoItem({ dueAt: 0 }).dueAt).toBe(0);

    const state = normalizeProductivityState({
      todoItems: [{ id: "epoch", title: "Epoch", date: "1970-01-01", dueAt: 0 }],
    });
    expect(state.todoItems[0].dueAt).toBe(0);
  });

  it("calculates recurring todo dates for day, week, month and year", () => {
    const mondayGym = makeTodoItem({
      id: "gym",
      title: "Academia",
      date: "2026-06-08",
      dueAt: new Date("2026-06-08T19:30:00").getTime(),
      recurrence: "weekly",
      recurrenceWeekdays: [1, 3],
    });
    const daily = makeTodoItem({ id: "daily", date: "2026-06-06", recurrence: "daily" });
    const monthly = makeTodoItem({ id: "monthly", date: "2026-01-31", recurrence: "monthly" });
    const yearly = makeTodoItem({ id: "yearly", date: "2024-02-29", recurrence: "yearly" });

    expect(nextTodoOccurrence(mondayGym)).toMatchObject({
      date: "2026-06-10",
      dueAt: new Date("2026-06-10T19:30:00").getTime(),
    });
    expect(nextTodoOccurrence(daily)?.date).toBe("2026-06-07");
    expect(nextTodoOccurrence(monthly)?.date).toBe("2026-02-28");
    expect(nextTodoOccurrence(yearly)?.date).toBe("2025-02-28");
  });

  it("returns due todo alerts repeatedly and respects snooze/dismiss", () => {
    const now = Date.UTC(2026, 5, 6, 14, 0, 0);
    const due = makeTodoItem({
      id: "due",
      title: "Enviar update",
      dueAt: now - 60_000,
    });
    const recent = makeTodoItem({
      id: "recent",
      title: "Avisado agora",
      dueAt: now - 60_000,
      lastNotifiedAt: now - 10_000,
    });
    const snoozed = makeTodoItem({
      id: "snoozed",
      title: "Adiado",
      dueAt: now - 60_000,
      snoozedUntil: now + 300_000,
    });
    const dismissed = makeTodoItem({
      id: "dismissed",
      title: "Parado",
      dueAt: now - 60_000,
      alertDismissedAt: now - 1_000,
    });

    expect(dueTodoAlerts([due, recent, snoozed, dismissed], now).map((r) => r.id)).toEqual(["due"]);
    expect(shouldRepeatTodoAlert({ ...due, lastNotifiedAt: now - 31_000 }, now)).toBe(true);
    expect(shouldRepeatTodoAlert({ ...due, lastNotifiedAt: now - 29_000 }, now)).toBe(false);
  });

  it("groups todos into selected day and overdue buckets", () => {
    const target = "2026-06-06";
    const buckets = todoBucketsForDate(
      [
        makeTodoItem({ id: "today", title: "Hoje", date: target, order: 2 }),
        makeTodoItem({ id: "old", title: "Atrasada", date: "2026-06-05", order: 1 }),
        makeTodoItem({
          id: "done",
          title: "Feita",
          date: "2026-06-05",
          completedAt: Date.UTC(2026, 5, 5),
        }),
      ],
      target,
    );

    expect(buckets.today.map((item) => item.id)).toEqual(["today"]);
    expect(buckets.overdue.map((item) => item.id)).toEqual(["old"]);
  });

  it("preserves the selected day when navigating calendar months", () => {
    expect(shiftDateKeyMonth("2026-06-15", 1, 15)).toBe("2026-07-15");
    expect(shiftDateKeyMonth("2026-07-15", -1, 15)).toBe("2026-06-15");
  });

  it("clamps short months while preserving the preferred day for later months", () => {
    expect(shiftDateKeyMonth("2026-01-31", 1, 31)).toBe("2026-02-28");
    expect(shiftDateKeyMonth("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(shiftDateKeyMonth("2026-03-31", -1, 31)).toBe("2026-02-28");
  });

  it("runs the pomodoro state machine with pause, resume, and long break rounds", () => {
    const started = startPomodoroTimer(
      makePomodoroTimer(DEFAULT_POMODORO_SETTINGS),
      DEFAULT_POMODORO_SETTINGS,
      1_000,
      "todo-1",
    );
    expect(started.status).toBe("running");
    expect(started.round).toBe("focus");
    expect(started.totalSeconds).toBe(DEFAULT_POMODORO_SETTINGS.focusMinutes * 60);

    const paused = pausePomodoroTimer(started, 31_000);
    expect(paused.status).toBe("paused");
    expect(paused.remainingSeconds).toBe(started.totalSeconds - 30);

    const resumed = resumePomodoroTimer(paused, 60_000);
    expect(resumed.status).toBe("running");
    expect(resumed.startedAt).toBe(60_000);

    const afterFocus = completePomodoroRound(
      { ...resumed, roundIndex: DEFAULT_POMODORO_SETTINGS.roundsPerLongBreak - 1 },
      DEFAULT_POMODORO_SETTINGS,
      70_000,
    );
    expect(afterFocus.timer.round).toBe("longBreak");
    expect(afterFocus.session).toMatchObject({
      round: "focus",
      todoId: "todo-1",
      completed: true,
    });
  });

  it("keeps productivity animation tokens aligned with the mixer feel", () => {
    expect(PRODUCTIVITY_ANIMATION_MS).toBe(450);
    expect(PRODUCTIVITY_CARD_STAGGER_MS).toBe(35);
  });
});
