import { useEffect, useState } from "react";

export interface ToastHandle {
  show: (message?: string) => void;
}

interface ToastProps {
  registerHandle?: (handle: ToastHandle) => void;
}

const TOAST_DURATION = 1500;

export function Toast({ registerHandle }: ToastProps) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("Salvo");

  useEffect(() => {
    if (!registerHandle) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    registerHandle({
      show: (msg) => {
        if (msg) setMessage(msg);
        else setMessage("Salvo");
        setVisible(true);
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => setVisible(false), TOAST_DURATION);
      },
    });
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [registerHandle]);

  return (
    <div className={`settings-toast${visible ? " visible" : ""}`} aria-live="polite">
      <span className="settings-toast-check" aria-hidden>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <span>{message}</span>
    </div>
  );
}
