import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  DEFAULT_RECORDING_PREFS,
  loadRecordingPrefs,
  saveRecordingPrefs,
  type RecordingPrefs,
} from "../../lib/recording-prefs";
import { userFacingError } from "../../lib/user-facing-errors";
import {
  featureAvailable,
  featureMessage,
  repairUrlForFeature,
  type RuntimeReadiness,
} from "../../lib/runtime-readiness";

interface AudioSource {
  name: string;
  kind: "microphone" | "system";
}

interface SectionGravacaoProps {
  onSaved: () => void;
}

export function SectionGravacao({ onSaved }: SectionGravacaoProps) {
  const [prefs, setPrefs] = useState<RecordingPrefs>(DEFAULT_RECORDING_PREFS);
  const [audioSources, setAudioSources] = useState<AudioSource[]>([]);
  const [audioSetupError, setAudioSetupError] = useState("");
  const [runtimeReadiness, setRuntimeReadiness] = useState<RuntimeReadiness | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loadedPrefs = await loadRecordingPrefs();
      if (cancelled) return;
      setPrefs(loadedPrefs);
      try {
        const readiness = await invoke<RuntimeReadiness>("runtime_readiness");
        if (cancelled) return;
        setRuntimeReadiness(readiness);
      } catch (err) {
        console.warn("[settings] runtime readiness failed:", err);
      }

      try {
        const sources = await invoke<AudioSource[]>("list_recording_audio_sources");
        if (cancelled) return;
        setAudioSources(sources);
        setAudioSetupError("");
      } catch (err) {
        if (!cancelled) {
          setAudioSources([]);
          setAudioSetupError(
            userFacingError(
              err,
              "Gravação não está disponível nesta instalação.",
            ),
          );
        }
        console.warn("[settings] list audio sources failed:", err);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = async (patch: Partial<RecordingPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await saveRecordingPrefs(next);
    try {
      await emit("settings://changed", { recording: next });
    } catch (err) {
      console.warn("[settings] emit recording failed:", err);
    }
    onSaved();
  };

  const systemAudioAvailable = audioSources.some((s) => s.kind === "system");
  const microphones = audioSources.filter((s) => s.kind === "microphone");
  const recordingAvailable =
    !runtimeReadiness || featureAvailable(runtimeReadiness, "recording");
  const repairUrl = repairUrlForFeature(runtimeReadiness, "recording");

  const openRepair = async () => {
    if (!repairUrl) return;
    try {
      await openUrl(repairUrl);
    } catch (err) {
      console.warn("[settings] open repair failed:", err);
    }
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Áudio</h2>
      <p className="settings-section-hint">Configure as fontes de áudio usadas ao gravar a tela.</p>
      {audioSetupError && (
        <p className="settings-section-hint" role="status">
          {audioSetupError}
        </p>
      )}
      {runtimeReadiness && !recordingAvailable && (
        <p className="settings-section-hint" role="status">
          {featureMessage(
            runtimeReadiness,
            "recording",
            "Recurso indisponível nesta instalação.",
          )}
        </p>
      )}
      {repairUrl && (
        <button type="button" className="settings-action-mini" onClick={openRepair}>
          Abrir reparo online
        </button>
      )}

      <div className="settings-card">
        <label className="settings-row">
          <input
            type="checkbox"
            checked={prefs.includeMicrophone}
            disabled={!recordingAvailable}
            onChange={(e) => update({ includeMicrophone: e.target.checked })}
          />
          <div className="settings-row-text">
            <span className="settings-row-label">Microfone</span>
            <span className="settings-row-desc">Incluir áudio do microfone na gravação.</span>
          </div>
        </label>

        <div className="settings-row settings-row-stacked">
          <span className="settings-row-label">Fonte do microfone</span>
          <select
            className="settings-select"
            value={prefs.selectedMicrophone ?? ""}
            disabled={!recordingAvailable || !prefs.includeMicrophone}
            onChange={(e) => update({ selectedMicrophone: e.target.value || undefined })}
          >
            <option value="">Auto</option>
            {microphones.map((source) => (
              <option key={source.name} value={source.name}>
                {source.name}
              </option>
            ))}
          </select>
        </div>

        <label className="settings-row">
          <input
            type="checkbox"
            checked={prefs.includeSystemAudio && systemAudioAvailable}
            disabled={!recordingAvailable || (loaded && !systemAudioAvailable)}
            onChange={(e) => update({ includeSystemAudio: e.target.checked })}
          />
          <div className="settings-row-text">
            <span className="settings-row-label">Áudio do sistema</span>
            <span className="settings-row-desc">
              {!loaded
                ? "Procurando fontes de áudio..."
                : !recordingAvailable || audioSetupError
                ? "Indisponível nesta instalação."
                : systemAudioAvailable
                ? "Captura o som que você ouve."
                : "Indisponível: sem Stereo Mix/loopback ativo."}
            </span>
          </div>
        </label>
      </div>

    </section>
  );
}
