import { useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  Repeat2,
  Trash2,
} from "lucide-react";
import ProductivityFrame from "./ProductivityFrame";
import { useProductivityState } from "./useProductivityState";
import {
  completeTodoItem,
  deleteTodoItem,
  localDateKey,
  makeTodoItem,
  shiftDateKeyMonth,
  todoBucketsForDate,
  upsertTodoItem,
  type TodoItem,
  type TodoRecurrence,
} from "../lib/productivity";
import { userFacingError } from "../lib/user-facing-errors";

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
const RECURRENCE_OPTIONS: Array<{ value: TodoRecurrence; label: string }> = [
  { value: "none", label: "Nao repetir" },
  { value: "daily", label: "Todo dia" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" },
  { value: "yearly", label: "Anual" },
];

function monthDays(dateKey: string): string[] {
  const [year, month] = dateKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const startOffset = first.getDay();
  const start = new Date(year, month - 1, 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) =>
    localDateKey(
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + index).getTime(),
    ),
  );
}

function monthLabel(dateKey: string): string {
  const [year, month] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function selectedDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function dayNumber(dateKey: string): string {
  return String(Number(dateKey.slice(-2)));
}

function dayOfDateKey(dateKey: string): number {
  return Number(dateKey.slice(-2));
}

function dateToDueAt(dateKey: string, time: string): number | null {
  if (!time) return null;
  const value = new Date(`${dateKey}T${time}`).getTime();
  return Number.isFinite(value) ? value : null;
}

function taskMeta(item: TodoItem): string {
  const parts: string[] = [];
  if (item.dueAt) {
    parts.push(
      new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(item.dueAt)),
    );
  }
  if (item.recurrence !== "none") {
    parts.push(
      item.recurrence === "daily"
        ? "todo dia"
        : item.recurrence === "weekly"
        ? "semanal"
        : item.recurrence === "monthly"
        ? "mensal"
        : "anual",
    );
  }
  return parts.join(" · ");
}

function weekdayForDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

export default function TodoCalendarApp() {
  const { state, loading, feedback, setFeedback } = useProductivityState();
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [preferredMonthDay, setPreferredMonthDay] = useState(() =>
    dayOfDateKey(localDateKey()),
  );
  const [title, setTitle] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [recurrence, setRecurrence] = useState<TodoRecurrence>("none");
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>([
    weekdayForDateKey(selectedDate),
  ]);

  const days = useMemo(() => monthDays(selectedDate), [selectedDate]);
  const buckets = useMemo(
    () => todoBucketsForDate(state?.todoItems ?? [], selectedDate),
    [selectedDate, state?.todoItems],
  );
  const countByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of state?.todoItems ?? []) {
      if (item.completedAt) continue;
      counts.set(item.date, (counts.get(item.date) ?? 0) + 1);
    }
    return counts;
  }, [state?.todoItems]);

  const changeSelectedDate = (date: string, updatePreferredDay = true) => {
    setSelectedDate(date);
    if (updatePreferredDay) {
      setPreferredMonthDay(dayOfDateKey(date));
    }
    setRecurrenceWeekdays((current) =>
      current.length ? current : [weekdayForDateKey(date)],
    );
  };

  const changeMonth = (monthDelta: number) => {
    changeSelectedDate(
      shiftDateKeyMonth(selectedDate, monthDelta, preferredMonthDay),
      false,
    );
  };

  const addTodo = async () => {
    if (!title.trim()) return;
    try {
      await upsertTodoItem(
        makeTodoItem({
          title,
          date: selectedDate,
          dueAt: dateToDueAt(selectedDate, dueTime),
          recurrence,
          recurrenceWeekdays: recurrence === "weekly" ? recurrenceWeekdays : [],
          order: buckets.today.length + 1,
        }),
      );
      setTitle("");
      setDueTime("");
      setRecurrence("none");
      setFeedback("Tarefa salva");
    } catch (err) {
      setFeedback(userFacingError(err, "Nao foi possivel salvar a tarefa."));
    }
  };

  const action = async (task: Promise<unknown>, ok: string, fallback: string) => {
    try {
      await task;
      setFeedback(ok);
    } catch (err) {
      setFeedback(userFacingError(err, fallback));
    }
  };

  const toggleWeekday = (weekday: number) => {
    setRecurrenceWeekdays((current) => {
      if (current.includes(weekday)) {
        const next = current.filter((item) => item !== weekday);
        return next.length ? next : [weekday];
      }
      return [...current, weekday].sort((a, b) => a - b);
    });
  };

  const renderTask = (item: TodoItem, index: number) => (
    <article
      className={`productivity-card todo-card${item.completedAt ? " done" : ""}`}
      key={item.id}
      style={{ "--item-delay": `${index * 35}ms` } as React.CSSProperties}
    >
      <button
        className="productivity-check"
        type="button"
        aria-label="Concluir tarefa"
        onClick={() =>
          void action(
            completeTodoItem(item.id),
            item.recurrence === "none" ? "Tarefa concluida" : "Proxima repeticao agendada",
            "Nao foi possivel concluir.",
          )
        }
      >
        <Check size={14} strokeWidth={2.4} absoluteStrokeWidth />
      </button>
      <div className="productivity-item-body">
        <div className="productivity-row">
          <span className="productivity-item-title">{item.title}</span>
          {taskMeta(item) ? <span className="productivity-chip">{taskMeta(item)}</span> : null}
        </div>
        {item.notes ? <div className="productivity-meta">{item.notes}</div> : null}
      </div>
      <button
        className="productivity-icon-button danger"
        type="button"
        title="Excluir"
        aria-label="Excluir"
        onClick={() =>
          void action(deleteTodoItem(item.id), "Tarefa excluida", "Nao foi possivel excluir.")
        }
      >
        <Trash2 size={14} strokeWidth={2.2} absoluteStrokeWidth />
      </button>
    </article>
  );

  return (
    <ProductivityFrame
      title="To-do Calendar"
      subtitle="Tarefas por data"
      Icon={CalendarDays}
      className="productivity-calendar"
      windowSize={{ width: 860, height: 560, minWidth: 760, minHeight: 520 }}
    >
      <section className="productivity-content productivity-calendar-layout">
        <div className="productivity-panel calendar-month-panel">
          <div className="productivity-row calendar-month-head">
            <button
              className="productivity-icon-button"
              type="button"
              title="Mes anterior"
              aria-label="Mes anterior"
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft size={16} strokeWidth={2.4} absoluteStrokeWidth />
            </button>
            <strong>{monthLabel(selectedDate)}</strong>
            <button
              className="productivity-icon-button"
              type="button"
              title="Proximo mes"
              aria-label="Proximo mes"
              onClick={() => changeMonth(1)}
            >
              <ChevronRight size={16} strokeWidth={2.4} absoluteStrokeWidth />
            </button>
          </div>
          <div className="productivity-calendar-weekdays" aria-hidden>
            {WEEKDAY_LABELS.map((day, index) => (
              <span key={`${day}-${index}`}>{day}</span>
            ))}
          </div>
          <div className="productivity-calendar-grid">
            {days.map((day) => (
              <button
                className={`productivity-day${day === selectedDate ? " active" : ""}${
                  day.slice(0, 7) !== selectedDate.slice(0, 7) ? " muted" : ""
                }`}
                key={day}
                type="button"
                title={day}
                onClick={() => changeSelectedDate(day)}
              >
                {dayNumber(day)}
                {countByDate.has(day) ? <small>{countByDate.get(day)}</small> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="productivity-panel calendar-agenda-panel">
          <div className="calendar-selected-head">
            <div>
              <span className="productivity-meta">Selecionado</span>
              <strong>{selectedDateLabel(selectedDate)}</strong>
            </div>
            <button
              className="productivity-command"
              type="button"
              onClick={() => changeSelectedDate(localDateKey())}
            >
              Hoje
            </button>
          </div>
          <div className="productivity-add-line calendar-add-line">
            <input
              value={title}
              placeholder="Nova tarefa"
              aria-label="Nova tarefa"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addTodo();
                }
              }}
            />
            <button className="productivity-command primary" type="button" onClick={addTodo}>
              <Plus size={15} strokeWidth={2.4} absoluteStrokeWidth />
              Adicionar
            </button>
          </div>
          <div className="calendar-task-controls">
            <label className="calendar-time-control">
              <Clock3 size={14} strokeWidth={2.2} absoluteStrokeWidth />
              <input
                type="time"
                value={dueTime}
                aria-label="Horario"
                onChange={(event) => setDueTime(event.target.value)}
              />
            </label>
            <div className="calendar-repeat-control">
              <Repeat2 size={14} strokeWidth={2.2} absoluteStrokeWidth />
              {RECURRENCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={recurrence === option.value ? "active" : ""}
                  onClick={() => setRecurrence(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {recurrence === "weekly" ? (
              <div className="calendar-weekday-picker" aria-label="Dias da semana">
                {WEEKDAY_LABELS.map((day, index) => (
                  <button
                    key={`${day}-${index}`}
                    type="button"
                    className={recurrenceWeekdays.includes(index) ? "active" : ""}
                    onClick={() => toggleWeekday(index)}
                  >
                    {day}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="productivity-scroll">
            {loading ? (
              <div className="productivity-empty">Carregando...</div>
            ) : (
              <>
                {buckets.overdue.length > 0 ? (
                  <div className="productivity-section-label">
                    <span>Atrasadas</span>
                    <small>{buckets.overdue.length}</small>
                  </div>
                ) : null}
                {buckets.overdue.map(renderTask)}
                {buckets.today.length === 0 && buckets.overdue.length === 0 ? (
                  <div className="productivity-empty">Nenhuma tarefa nesta data</div>
                ) : (
                  buckets.today.map((item, index) =>
                    renderTask(item, index + buckets.overdue.length),
                  )
                )}
              </>
            )}
          </div>
        </div>
      </section>
      {feedback ? <div className="productivity-toast">{feedback}</div> : null}
    </ProductivityFrame>
  );
}
