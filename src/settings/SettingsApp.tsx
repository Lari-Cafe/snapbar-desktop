import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  FileSliders,
  FolderOpen,
  Info,
  Keyboard,

  SlidersHorizontal,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { SectionArquivos } from "./sections/SectionArquivos";
import { SectionAudio } from "./sections/SectionAudio";

import { SectionJanela } from "./sections/SectionJanela";
import { SectionAtalhos } from "./sections/SectionAtalhos";
import { SectionSobre } from "./sections/SectionSobre";
import { Toast, type ToastHandle } from "./components/Toast";
import "./SettingsApp.css";

type SettingsPage = "general" | "shortcuts" | "audio" | "files" | "about";

const SETTINGS_NAV: { id: SettingsPage; label: string; Icon: LucideIcon }[] = [
  { id: "general", label: "Geral", Icon: SlidersHorizontal },
  { id: "shortcuts", label: "Atalhos", Icon: Keyboard },
  { id: "audio", label: "Áudio", Icon: Volume2 },
  { id: "files", label: "Arquivos", Icon: FolderOpen },

  { id: "about", label: "Sobre", Icon: Info },
];

export default function SettingsApp() {
  const toastRef = useRef<ToastHandle | null>(null);
  const [activePage, setActivePage] = useState<SettingsPage>("general");

  const showToast = useCallback((message?: string) => {
    toastRef.current?.show(message ?? "Salvo");
  }, []);

  const showError = useCallback((message: string) => {
    toastRef.current?.show(message);
  }, []);

  // ESC fecha a janela
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        getCurrentWindow().close().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleClose = () => {
    getCurrentWindow().close().catch(() => {});
  };

  const pageTitle = useMemo(
    () => SETTINGS_NAV.find((item) => item.id === activePage)?.label ?? "Geral",
    [activePage],
  );
  const activeIndex = Math.max(
    SETTINGS_NAV.findIndex((item) => item.id === activePage),
    0,
  );

  return (
    <div className="settings-window">
      <header className="settings-header" data-tauri-drag-region>
        <h1 className="settings-title" data-tauri-drag-region>
          Configurações
        </h1>
        <button
          type="button"
          className="settings-close"
          onClick={handleClose}
          title="Fechar (ESC)"
          aria-label="Fechar"
        >
          <X size={16} strokeWidth={2} absoluteStrokeWidth />
        </button>
      </header>

      <main className="settings-shell">
        <aside className="settings-sidebar" aria-label="Seções de configurações">
          <div className="settings-sidebar-brand">
            <FileSliders size={16} strokeWidth={2} absoluteStrokeWidth />
            <span>Preferências</span>
          </div>
          <nav
            className="settings-nav"
            style={{ "--settings-active-index": activeIndex } as CSSProperties}
          >
            {SETTINGS_NAV.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`settings-nav-item${activePage === id ? " active" : ""}`}
                onClick={() => setActivePage(id)}
                aria-current={activePage === id ? "page" : undefined}
              >
                <Icon size={15} strokeWidth={2} absoluteStrokeWidth />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="settings-content" aria-label={pageTitle}>
          <div key={activePage} className="settings-content-panel">
            {activePage === "general" && <SectionJanela onSaved={() => showToast()} />}
            {activePage === "shortcuts" && (
              <SectionAtalhos onSaved={() => showToast()} onError={showError} />
            )}
            {activePage === "audio" && <SectionAudio onSaved={() => showToast()} />}
            {activePage === "files" && (
              <SectionArquivos onSaved={() => showToast()} onError={showError} />
            )}

            {activePage === "about" && (
              <SectionSobre onSaved={showToast} onError={showError} />
            )}
          </div>
        </section>
      </main>

      <Toast registerHandle={(handle) => (toastRef.current = handle)} />
    </div>
  );
}
