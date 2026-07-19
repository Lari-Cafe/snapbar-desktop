import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Flame, X } from "lucide-react";
import { SectionTypoFire } from "../settings/sections/SectionTypoFire";
import { Toast, type ToastHandle } from "../settings/components/Toast";
import "../settings/SettingsApp.css";
import "./TypoFireApp.css";

export default function TypoFireApp() {
  const toastRef = useRef<ToastHandle | null>(null);

  const showToast = useCallback((message?: string) => {
    toastRef.current?.show(message ?? "Salvo");
  }, []);

  const showError = useCallback((message: string) => {
    toastRef.current?.show(message);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        getCurrentWindow().close().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = () => {
    getCurrentWindow().close().catch(() => {});
  };

  return (
    <div className="settings-window typo-fire-window">
      <header className="settings-header typo-fire-window-header" data-tauri-drag-region>
        <h1 className="settings-title typo-fire-window-title" data-tauri-drag-region>
          <Flame size={15} strokeWidth={2.2} absoluteStrokeWidth />
          <span>Typo Fire</span>
        </h1>
        <button
          type="button"
          className="settings-close"
          onClick={close}
          title="Fechar (ESC)"
          aria-label="Fechar"
        >
          <X size={16} strokeWidth={2} absoluteStrokeWidth />
        </button>
      </header>

      <main className="typo-fire-tool-content">
        <SectionTypoFire onSaved={showToast} onError={showError} />
      </main>

      <Toast registerHandle={(handle) => (toastRef.current = handle)} />
    </div>
  );
}
