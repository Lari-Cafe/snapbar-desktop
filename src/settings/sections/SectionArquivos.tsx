import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { FolderOpen, RotateCcw } from "lucide-react";
import {
  DEFAULT_OUTPUT_PATHS,
  loadOutputPaths,
  saveOutputPaths,
  type OutputPathSettings,
} from "../../lib/app-settings";
import { userFacingError } from "../../lib/user-facing-errors";

interface SectionArquivosProps {
  onSaved: () => void;
  onError: (message: string) => void;
}

type OutputPathKey = keyof OutputPathSettings;

async function emitChanged(outputPaths: OutputPathSettings): Promise<void> {
  try {
    await emit("settings://changed", { outputPaths });
  } catch (err) {
    console.warn("[settings] emit output paths failed:", err);
  }
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function SectionArquivos({ onSaved, onError }: SectionArquivosProps) {
  const [outputPaths, setOutputPaths] = useState<OutputPathSettings>(DEFAULT_OUTPUT_PATHS);
  const [choosingKey, setChoosingKey] = useState<OutputPathKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOutputPaths()
      .then((loaded) => {
        if (!cancelled) setOutputPaths(loaded);
      })
      .catch((err) => {
        console.warn("[settings] load output paths failed:", err);
        if (!cancelled) onError("Não foi possível carregar as pastas.");
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const update = async (patch: Partial<OutputPathSettings>) => {
    const next = await saveOutputPaths(patch);
    setOutputPaths(next);
    await emitChanged(next);
    onSaved();
  };

  const chooseFolder = async (key: OutputPathKey) => {
    if (choosingKey !== null) return;
    setChoosingKey(key);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const defaultPath = outputPaths[key];
      const selected = await open({
        directory: true,
        multiple: false,
        ...(defaultPath ? { defaultPath } : {}),
      });
      if (typeof selected !== "string") return;
      await update({ [key]: selected });
    } catch (err) {
      onError(userFacingError(err, "Não foi possível escolher a pasta."));
    } finally {
      setChoosingKey(null);
    }
  };

  const resetFolder = async (key: OutputPathKey) => {
    await update({ [key]: undefined });
  };

  const rows: Array<{
    key: OutputPathKey;
    label: string;
    fallback: string;
  }> = [
    {
      key: "screenshotDir",
      label: "Prints",
      fallback: "Padrão: Imagens\\FloatingToolbar",
    },
    {
      key: "recordingDir",
      label: "Vídeos",
      fallback: "Padrão: Vídeos\\FloatingToolbar",
    },
    {
      key: "internetDownloadDir",
      label: "Downloads da Internet",
      fallback: "Padrão: Downloads do Windows",
    },
  ];

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Arquivos</h2>
      <p className="settings-section-hint">
        Escolha onde prints, gravações e downloads da Internet serão salvos.
      </p>

      <div className="settings-card">
        {rows.map((row) => {
          const value = outputPaths[row.key];
          return (
            <div className="settings-row settings-path-row" key={row.key}>
              <div className="settings-row-text">
                <span className="settings-row-label">{row.label}</span>
                <span
                  className={`settings-path-value${value ? "" : " is-default"}`}
                  title={value ?? row.fallback}
                >
                  {value ? basename(value) : row.fallback}
                </span>
              </div>
              <div className="settings-row-actions">
                <button
                  type="button"
                  className="settings-icon-action"
                  onClick={() => chooseFolder(row.key)}
                  disabled={choosingKey !== null}
                  title={`Escolher pasta de ${row.label.toLowerCase()}`}
                  aria-label={`Escolher pasta de ${row.label.toLowerCase()}`}
                >
                  <FolderOpen size={15} strokeWidth={2} absoluteStrokeWidth />
                </button>
                {value && (
                  <button
                    type="button"
                    className="settings-icon-action"
                    onClick={() => resetFolder(row.key)}
                    disabled={choosingKey !== null}
                    title="Usar pasta padrão"
                    aria-label="Usar pasta padrão"
                  >
                    <RotateCcw size={15} strokeWidth={2} absoluteStrokeWidth />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
