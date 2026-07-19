import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { resetAllSettings } from "../../lib/app-settings";
import { userFacingError } from "../../lib/user-facing-errors";

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

const GITHUB_URL = "https://github.com/Lari-Cafe/snapbar-desktop";
const APP_VERSION = "0.1.0";

interface SectionSobreProps {
  onSaved: (message?: string) => void;
  onError: (message: string) => void;
}

export function SectionSobre({ onSaved, onError }: SectionSobreProps) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const openGithub = async () => {
    try {
      await openUrl(GITHUB_URL);
    } catch (err) {
      onError(userFacingError(err, "Não foi possível abrir o repositório."));
    }
  };

  const handleReset = async () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setResetting(true);
    try {
      await invoke("unregister_all_shortcuts").catch(() => {});
      await resetAllSettings();
      await emit("settings://reset", {});
      onSaved("Configurações restauradas");
      setTimeout(() => {
        getCurrentWindow().close().catch(() => {});
      }, 600);
    } catch (err) {
      onError(userFacingError(err, "Não foi possível restaurar as configurações."));
    } finally {
      setResetting(false);
      setConfirming(false);
    }
  };


  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Sobre</h2>

      <div className="settings-card settings-about">
        <div className="settings-about-logo-wrap">
          <img className="settings-about-logo" src="/snapbar-logo.png" alt="Snapbar" />
        </div>
        <div className="settings-about-version">
          <span className="settings-about-name">Snapbar</span>
          <span className="settings-about-tag">v{APP_VERSION}</span>
        </div>

        <button type="button" className="settings-action-btn" onClick={openGithub}>
          <GithubIcon />
          <span>Abrir repositório</span>
          <span className="settings-action-suffix"><ExternalIcon /></span>
        </button>


        <button
          type="button"
          className={`settings-action-btn danger${confirming ? " confirming" : ""}`}
          onClick={handleReset}
          disabled={resetting}
        >
          <ResetIcon />
          <span>
            {resetting
              ? "Restaurando..."
              : confirming
              ? "Clique de novo para confirmar"
              : "Restaurar padrões"}
          </span>
        </button>
      </div>
    </section>
  );
}
