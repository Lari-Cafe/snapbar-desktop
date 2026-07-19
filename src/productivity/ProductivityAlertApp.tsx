import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BellRing, Check, Clock3, X } from "lucide-react";
import { fitCurrentWindowToViewport } from "../lib/adaptive-window-geometry";
import {
  startProductivityAlarm,
  stopProductivityAlarm,
} from "./productivity-alert-sound";
import {
  completeTodoItem,
  dismissTodoAlert,
  dueTodoAlerts,
  snoozeTodoAlert,
  type TodoItem,
} from "../lib/productivity";
import { userFacingError } from "../lib/user-facing-errors";
import { useProductivityState } from "./useProductivityState";
import "./Productivity.css";

function alertIdFromHash(): string | null {
  const hash = window.location.hash;
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return null;
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return params.get("id");
}

function alertTime(item: TodoItem): string {
  const when = item.snoozedUntil ?? item.dueAt;
  if (!when) return "Agora";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(when));
}

export default function ProductivityAlertApp() {
  const { state, loading, applyState } = useProductivityState();
  const [feedback, setFeedback] = useState("");
  const requestedId = alertIdFromHash();
  const dueItems = useMemo(
    () => dueTodoAlerts(state?.todoItems ?? []),
    [state?.todoItems],
  );
  const item =
    dueItems.find((todo) => todo.id === requestedId) ??
    (requestedId
      ? state?.todoItems.find((todo) => todo.id === requestedId && !todo.completedAt)
      : dueItems[0]);

  useEffect(() => {
    fitCurrentWindowToViewport({
      anchor: "top-right",
      placement: "bottom-end",
      width: 360,
      height: 176,
      minWidth: 320,
      minHeight: 150,
      margin: 18,
    }).catch((err) => {
      console.warn("[productivity-alert] geometry failed:", err);
      getCurrentWindow().show().catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (!loading && state && !item) {
      window.setTimeout(() => {
        stopProductivityAlarm("todo");
        getCurrentWindow().close().catch(() => {});
      }, 180);
    }
  }, [item, loading, state]);

  useEffect(() => {
    if (!item) return;
    startProductivityAlarm("todo");
    return () => stopProductivityAlarm("todo");
  }, [item?.id]);

  const run = async (task: Promise<unknown>) => {
    if (!item) return;
    try {
      stopProductivityAlarm("todo");
      const next = await task;
      if (next && typeof next === "object") applyState(next as Parameters<typeof applyState>[0]);
      await getCurrentWindow().close();
    } catch (err) {
      setFeedback(userFacingError(err, "Nao foi possivel atualizar a tarefa."));
    }
  };

  return (
    <main className="productivity-alert-window phase-opening">
      <section className="productivity-alert-card">
        <div className="productivity-alert-icon" aria-hidden>
          <BellRing size={18} strokeWidth={2.3} absoluteStrokeWidth />
        </div>
        <div className="productivity-alert-body">
          <span className="productivity-alert-kicker">Lembrete</span>
          <strong>{item?.title ?? "Tarefa pendente"}</strong>
          <small>
            <Clock3 size={12} strokeWidth={2.2} absoluteStrokeWidth />
            {item ? alertTime(item) : "Agora"}
          </small>
        </div>
        <button
          className="productivity-icon-button danger"
          type="button"
          title="Parar"
          aria-label="Parar alerta"
          onClick={() => item && void run(dismissTodoAlert(item.id))}
        >
          <X size={15} strokeWidth={2.4} absoluteStrokeWidth />
        </button>
      </section>
      <div className="productivity-alert-actions">
        <button
          className="productivity-command primary"
          type="button"
          onClick={() => item && void run(completeTodoItem(item.id))}
        >
          <Check size={14} strokeWidth={2.4} absoluteStrokeWidth />
          Concluir
        </button>
        <button
          className="productivity-command"
          type="button"
          onClick={() => item && void run(snoozeTodoAlert(item.id, 5))}
        >
          +5 min
        </button>
        <button
          className="productivity-command"
          type="button"
          onClick={() => item && void run(snoozeTodoAlert(item.id, 10))}
        >
          +10 min
        </button>
      </div>
      {feedback ? <div className="productivity-alert-feedback">{feedback}</div> : null}
    </main>
  );
}
