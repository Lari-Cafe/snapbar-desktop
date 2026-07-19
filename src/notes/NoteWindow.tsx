import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { Minus, Palette, Plus, Trash2, Type, X } from "lucide-react";
import {
  DEFAULT_NOTE_COLOR,
  DEFAULT_NOTE_FONT_SIZE,
  DEFAULT_NOTE_OPACITY,
  MAX_NOTE_FONT_SIZE,
  MAX_NOTE_OPACITY,
  MIN_NOTE_FONT_SIZE,
  MIN_NOTE_OPACITY,
  NOTES_CHANGED_EVENT,
  NOTE_COLOR_PRESETS,
  NOTE_FONT_SIZE_STEP,
  clampNoteFontSize,
  clampNoteOpacity,
  createNote,
  deleteNote,
  getNote,
  noteSurfaceStyle,
  updateNote,
  type Note,
} from "../lib/notes";
import "./NoteWindow.css";

const CONTENT_DEBOUNCE_MS = 400;
const GEOMETRY_DEBOUNCE_MS = 350;

function getNoteIdFromHash(): string | null {
  const hash = window.location.hash;
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return null;
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return params.get("id");
}

export default function NoteWindow() {
  const noteId = getNoteIdFromHash();
  const [note, setNote] = useState<Note | null>(null);
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const contentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geometryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedRef = useRef(false);

  const clearPendingSaves = useCallback(() => {
    if (contentTimer.current) {
      clearTimeout(contentTimer.current);
      contentTimer.current = null;
    }
    if (geometryTimer.current) {
      clearTimeout(geometryTimer.current);
      geometryTimer.current = null;
    }
  }, []);

  const closeOrphanWindow = useCallback(async () => {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.warn("[note] close orphan failed:", err);
    }
  }, []);

  // Carrega a nota dona desta janela.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!noteId) {
        setLoaded(true);
        return;
      }
      const found = await getNote(noteId);
      if (cancelled) return;
      setNote(found);
      setContent(found?.content ?? "");
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  useEffect(() => {
    if (loaded && !note) {
      void closeOrphanWindow();
    }
  }, [closeOrphanWindow, loaded, note]);

  // Salva geometria (posicao/tamanho) quando o usuario move ou redimensiona.
  useEffect(() => {
    if (!noteId || deletedRef.current) return;
    let disposed = false;
    const unlisten: Array<() => void> = [];

    const saveGeometry = () => {
      if (deletedRef.current) return;
      if (geometryTimer.current) clearTimeout(geometryTimer.current);
      geometryTimer.current = setTimeout(async () => {
        if (deletedRef.current || disposed) return;
        try {
          const win = getCurrentWindow();
          const scale = await win.scaleFactor();
          const pos = (await win.outerPosition()).toLogical(scale);
          const size = (await win.innerSize()).toLogical(scale);
          await updateNote(noteId, {
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            width: Math.round(size.width),
            height: Math.round(size.height),
          });
        } catch (err) {
          console.warn("[note] save geometry failed:", err);
        }
      }, GEOMETRY_DEBOUNCE_MS);
    };

    (async () => {
      const win = getCurrentWindow();
      const offMoved = await win.onMoved(saveGeometry);
      const offResized = await win.onResized(saveGeometry);
      if (disposed) {
        offMoved();
        offResized();
        return;
      }
      unlisten.push(offMoved, offResized);
    })();

    return () => {
      disposed = true;
      if (geometryTimer.current) {
        clearTimeout(geometryTimer.current);
        geometryTimer.current = null;
      }
      unlisten.forEach((off) => off());
    };
  }, [noteId]);

  const persistContent = useCallback(
    (value: string) => {
      if (!noteId || deletedRef.current) return;
      if (contentTimer.current) clearTimeout(contentTimer.current);
      contentTimer.current = setTimeout(() => {
        if (deletedRef.current) return;
        updateNote(noteId, { content: value }).catch((err) =>
          console.warn("[note] save content failed:", err),
        );
      }, CONTENT_DEBOUNCE_MS);
    },
    [noteId],
  );

  const handleContentChange = (value: string) => {
    setContent(value);
    persistContent(value);
  };

  const handleColor = async (color: string) => {
    if (!noteId) return;
    const updated = await updateNote(noteId, { color });
    if (updated) setNote(updated);
  };

  const handleOpacity = async (value: number) => {
    if (!noteId) return;
    const updated = await updateNote(noteId, { opacity: clampNoteOpacity(value) });
    if (updated) setNote(updated);
  };

  const handleFontSize = async (delta: number) => {
    if (!noteId) return;
    const current = note?.fontSize ?? DEFAULT_NOTE_FONT_SIZE;
    const next = clampNoteFontSize(current + delta);
    if (next === current) return;
    const updated = await updateNote(noteId, { fontSize: next });
    if (updated) setNote(updated);
  };

  const handleNewNote = async () => {
    try {
      const created = await createNote();
      await invoke("open_note_window", { noteId: created.id });
    } catch (err) {
      console.warn("[note] create new failed:", err);
    }
  };

  const handleDelete = async () => {
    if (!noteId) {
      await getCurrentWindow().close().catch((err) =>
        console.warn("[note] close failed:", err),
      );
      return;
    }
    deletedRef.current = true;
    clearPendingSaves();
    try {
      await deleteNote(noteId);
      setNote(null);
      setContent("");
      await emit(NOTES_CHANGED_EVENT, { deletedId: noteId });
      await getCurrentWindow().close();
    } catch (err) {
      deletedRef.current = false;
      console.warn("[note] delete failed:", err);
    }
  };

  const handleClose = async () => {
    // Apenas esconde a nota: ela continua salva e reabre depois.
    try {
      if (contentTimer.current) {
        clearTimeout(contentTimer.current);
        contentTimer.current = null;
        if (noteId && !deletedRef.current) await updateNote(noteId, { content });
      }
      await getCurrentWindow().close();
    } catch (err) {
      console.warn("[note] close failed:", err);
    }
  };

  const color = note?.color ?? DEFAULT_NOTE_COLOR;
  const fontSize = note?.fontSize ?? DEFAULT_NOTE_FONT_SIZE;
  const opacity = note?.opacity ?? DEFAULT_NOTE_OPACITY;
  const surface = noteSurfaceStyle(color, false, opacity);

  if (loaded && !note) {
    return <main className="note note-orphan" aria-hidden="true" />;
  }

  return (
    <main
      className="note"
      style={{ background: surface.background, borderColor: surface.borderColor }}
    >
      <header className="note-header" data-tauri-drag-region>
        <div className="note-colors" role="group" aria-label="Cor da nota">
          {NOTE_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              className={`note-color-dot${c === color ? " selected" : ""}`}
              style={{ background: c }}
              aria-label={`Cor ${c}`}
              aria-pressed={c === color}
              onClick={() => handleColor(c)}
            />
          ))}
        </div>
        <div className="note-actions">
          <button
            type="button"
            className={`note-action${showPalette ? " active" : ""}`}
            title="Paleta (cor e opacidade)"
            aria-label="Paleta"
            aria-pressed={showPalette}
            onClick={() => setShowPalette((v) => !v)}
          >
            <Palette size={14} strokeWidth={2.2} absoluteStrokeWidth />
          </button>
          <div className="note-font-size" role="group" aria-label="Tamanho da fonte">
            <button
              type="button"
              className="note-action"
              title="Diminuir fonte"
              aria-label="Diminuir fonte"
              disabled={fontSize <= MIN_NOTE_FONT_SIZE}
              onClick={() => handleFontSize(-NOTE_FONT_SIZE_STEP)}
            >
              <Minus size={13} strokeWidth={2.6} absoluteStrokeWidth />
            </button>
            <Type size={13} strokeWidth={2.2} absoluteStrokeWidth aria-hidden />
            <button
              type="button"
              className="note-action"
              title="Aumentar fonte"
              aria-label="Aumentar fonte"
              disabled={fontSize >= MAX_NOTE_FONT_SIZE}
              onClick={() => handleFontSize(NOTE_FONT_SIZE_STEP)}
            >
              <Plus size={13} strokeWidth={2.6} absoluteStrokeWidth />
            </button>
          </div>
          <button
            type="button"
            className="note-action"
            title="Nova nota"
            aria-label="Nova nota"
            onClick={handleNewNote}
          >
            <Plus size={15} strokeWidth={2.4} absoluteStrokeWidth />
          </button>
          <button
            type="button"
            className="note-action"
            title="Excluir nota"
            aria-label="Excluir nota"
            onClick={handleDelete}
          >
            <Trash2 size={14} strokeWidth={2.2} absoluteStrokeWidth />
          </button>
          <button
            type="button"
            className="note-action"
            title="Fechar nota"
            aria-label="Fechar nota"
            onClick={handleClose}
          >
            <X size={15} strokeWidth={2.4} absoluteStrokeWidth />
          </button>
        </div>
      </header>
      {showPalette && (
        <div className="note-palette">
          <label className="note-palette-row">
            <span>Cor</span>
            <input
              type="color"
              className="note-color-wheel"
              value={color}
              onChange={(event) => handleColor(event.target.value)}
            />
          </label>
          <label className="note-palette-row">
            <span>Opacidade</span>
            <input
              type="range"
              min={Math.round(MIN_NOTE_OPACITY * 100)}
              max={Math.round(MAX_NOTE_OPACITY * 100)}
              value={Math.round(opacity * 100)}
              onChange={(event) => handleOpacity(Number(event.target.value) / 100)}
            />
            <span className="note-palette-value">{Math.round(opacity * 100)}%</span>
          </label>
        </div>
      )}
      <textarea
        className="note-textarea"
        style={{ fontSize: `${fontSize}px` }}
        value={content}
        placeholder="Escreva sua nota..."
        spellCheck={false}
        autoFocus
        onChange={(event) => handleContentChange(event.target.value)}
      />
    </main>
  );
}
