import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  loadShortcuts,
  saveShortcut,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutMap,
} from "../../lib/app-settings";
import { userFacingError } from "../../lib/user-facing-errors";
import { ShortcutCaptureField } from "../components/ShortcutCaptureField";

interface SectionAtalhosProps {
  onSaved: () => void;
  onError: (message: string) => void;
}

async function emitChanged(shortcuts: ShortcutMap): Promise<void> {
  try {
    await emit("settings://changed", { shortcuts });
  } catch (err) {
    console.warn("[settings] emit failed:", err);
  }
}

export function SectionAtalhos({ onSaved, onError }: SectionAtalhosProps) {
  const [shortcuts, setShortcuts] = useState<ShortcutMap>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadShortcuts();
      if (!cancelled) setShortcuts(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = async (action: ShortcutAction, accelerator: string | null) => {
    try {
      // Desregistra anterior se existia
      if (shortcuts[action]) {
        try {
          await invoke("unregister_shortcut", { action });
        } catch (err) {
          console.warn("[settings] unregister failed:", err);
        }
      }
      // Registra novo se houver
      if (accelerator) {
        await invoke("register_shortcut", { action, accelerator });
      }
      const next = await saveShortcut(action, accelerator);
      setShortcuts(next);
      await emitChanged(next);
      onSaved();
    } catch (err) {
      onError(userFacingError(err, "Não foi possível salvar o atalho."));
    }
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Atalhos de teclado</h2>
      <p className="settings-section-hint">
        Clique no campo e aperte a combinacao desejada. ESC cancela.
      </p>

      <div className="settings-card">
        {SHORTCUT_ACTIONS.map((action, idx) => (
          <div
            key={action.id}
            className={`settings-row settings-row-shortcut${
              idx < SHORTCUT_ACTIONS.length - 1 ? " has-divider" : ""
            }`}
          >
            <div className="settings-row-text">
              <span className="settings-row-label">{action.label}</span>
              <span className="settings-row-desc">{action.hint}</span>
            </div>
            <ShortcutCaptureField
              value={shortcuts[action.id]}
              onChange={(accel) => update(action.id, accel)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
