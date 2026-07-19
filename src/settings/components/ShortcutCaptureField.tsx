import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface ShortcutCaptureFieldProps {
  value?: string;
  onChange: (accelerator: string | null) => void;
  disabled?: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

function eventToAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Super");

  let key = e.key;
  if (MODIFIER_KEYS.has(key)) return null;

  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  else if (/^F[0-9]+$/.test(key)) key = key;
  else if (key === "Escape" || key === "Tab" || key === "Enter") {
    return null;
  }

  parts.push(key);
  return parts.join("+");
}

export function ShortcutCaptureField({ value, onChange, disabled }: ShortcutCaptureFieldProps) {
  const [recording, setRecording] = useState(false);
  const fieldRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setRecording(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const accel = eventToAccelerator(e);
      if (accel) {
        onChange(accel);
        setRecording(false);
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true } as EventListenerOptions);
    };
  }, [recording, onChange]);

  const startRecording = () => {
    if (disabled) return;
    setRecording(true);
    fieldRef.current?.focus();
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <div className="shortcut-field-wrap">
      <button
        ref={fieldRef}
        type="button"
        className={`shortcut-field${recording ? " recording" : ""}${value ? " has-value" : ""}`}
        onClick={startRecording}
        onBlur={() => setRecording(false)}
        disabled={disabled}
        title={recording ? "Aperte a combinacao desejada (ESC para cancelar)" : "Clique para gravar atalho"}
      >
        {recording ? (
          <span className="shortcut-recording">Gravando...</span>
        ) : value ? (
          <span className="shortcut-value">{value}</span>
        ) : (
          <span className="shortcut-empty">Sem atalho</span>
        )}
      </button>
      {value && !recording && (
        <button
          type="button"
          className="shortcut-clear"
          onClick={clear}
          aria-label="Remover atalho"
          title="Remover atalho"
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
