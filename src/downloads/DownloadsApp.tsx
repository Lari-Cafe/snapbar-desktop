import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Download,
  Film,
  FolderOpen,
  LoaderCircle,
  Music,
  RotateCcw,
  X,
} from "lucide-react";
import {
  bestSelectableVideoQuality,
  canAnalyzeDownloadUrl,
  DEFAULT_INTERNET_DOWNLOAD_OPTIONS,
  internetDownloadStatusText,
  normalizeInternetDownloadOptions,
  upsertInternetDownloadEvent,
  type AudioQualityKbps,
  type InternetDownloadEvent,
  type InternetDownloadFormat,
  type InternetDownloadJob,
  type InternetDownloadProbeResult,
  type VideoQualityPreset,
} from "../lib/internet-downloads";
import { loadOutputPaths, saveOutputPaths } from "../lib/app-settings";
import { userFacingError } from "../lib/user-facing-errors";
import "./DownloadsApp.css";

const VIDEO_QUALITIES: Array<{ id: VideoQualityPreset; label: string }> = [
  { id: "1080p", label: "1080p" },
  { id: "720p", label: "720p" },
  { id: "480p", label: "480p" },
];

const AUDIO_QUALITIES: AudioQualityKbps[] = [128, 192, 320];

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function sourceLabel(probe: InternetDownloadProbeResult | null): string {
  if (!probe) return "";
  const duration =
    typeof probe.durationSeconds === "number"
      ? ` · ${Math.round(probe.durationSeconds / 60)} min`
      : "";
  return `${probe.source}${duration}`;
}

function fallbackFeedback(
  url: string,
  status: "idle" | "loading" | "ready" | "error",
): string {
  if (status === "loading") return "Analisando link...";
  if (status === "ready") return "Qualidades carregadas. Escolha o formato e baixe.";
  if (status === "error") return "Não consegui analisar este link.";
  return url.trim()
    ? "Cole um link público que comece com http ou https."
    : "Cole um link para analisar antes de baixar.";
}

export default function DownloadsApp() {
  const [url, setUrl] = useState("");
  const [options, setOptions] = useState(DEFAULT_INTERNET_DOWNLOAD_OPTIONS);
  const [probe, setProbe] = useState<InternetDownloadProbeResult | null>(null);
  const [probeStatus, setProbeStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [feedback, setFeedback] = useState("");
  const [jobs, setJobs] = useState<InternetDownloadJob[]>([]);
  const [starting, setStarting] = useState(false);
  const lastAnalyzedRef = useRef("");
  const urlRef = useRef("");

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const paths = await loadOutputPaths();
      if (!cancelled) {
        setOptions((current) =>
          normalizeInternetDownloadOptions({
            ...current,
            outputDir: paths.internetDownloadDir,
          }),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await listen<InternetDownloadEvent>("downloads://job", (event) => {
        setJobs((current) => {
          return upsertInternetDownloadEvent(
            current,
            event.payload,
            event.payload.url ?? urlRef.current,
          );
        });
        const text = internetDownloadStatusText(event.payload);
        if (text) setFeedback(text);
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setProbe(null);
      setProbeStatus("idle");
      setFeedback("");
      lastAnalyzedRef.current = "";
      return;
    }
    if (!canAnalyzeDownloadUrl(trimmed)) {
      setProbe(null);
      setProbeStatus("idle");
      setFeedback("Cole um link público que comece com http ou https.");
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      if (lastAnalyzedRef.current === trimmed) return;
      lastAnalyzedRef.current = trimmed;
      setProbeStatus("loading");
      setFeedback("Analisando link...");
      try {
        const result = await invoke<InternetDownloadProbeResult>("internet_download_probe", {
          url: trimmed,
        });
        setProbe(result);
        setProbeStatus("ready");
        setFeedback(result.message ?? "Qualidades carregadas.");
        if (!result.availableVideoQualities.includes(options.videoQuality)) {
          setOptions((current) => ({
            ...current,
            videoQuality: bestSelectableVideoQuality(result.availableVideoQualities),
          }));
        }
      } catch (err) {
        setProbe(null);
        setProbeStatus("error");
        setFeedback(
          userFacingError(
            err,
            "Não consegui analisar este link. Verifique se ele é público.",
          ),
        );
      }
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [url, options.videoQuality]);

  const activeJob = useMemo(
    () => jobs.find((job) => job.status === "downloading" || job.status === "processing"),
    [jobs],
  );
  const canStart =
    canAnalyzeDownloadUrl(url) &&
    probeStatus !== "loading" &&
    !starting &&
    !activeJob;
  const isPreparing = starting || probeStatus === "loading";

  const setFormat = (format: InternetDownloadFormat) => {
    setOptions((current) => normalizeInternetDownloadOptions({ ...current, format }));
  };

  const chooseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: options.outputDir,
      });
      if (typeof selected !== "string") return;
      const saved = await saveOutputPaths({ internetDownloadDir: selected });
      setOptions((current) =>
        normalizeInternetDownloadOptions({
          ...current,
          outputDir: saved.internetDownloadDir,
        }),
      );
      setFeedback(`Pasta: ${selected}`);
    } catch (err) {
      setFeedback(userFacingError(err, "Não foi possível escolher a pasta."));
    }
  };

  const resetFolder = async () => {
    const saved = await saveOutputPaths({ internetDownloadDir: undefined });
    setOptions((current) =>
      normalizeInternetDownloadOptions({
        ...current,
        outputDir: saved.internetDownloadDir,
      }),
    );
    setFeedback("Pasta: Downloads do Windows");
  };

  const startDownload = async () => {
    if (!canStart) return;
    setStarting(true);
    setFeedback("Preparando download...");
    try {
      const event = await invoke<InternetDownloadEvent>("internet_download_start", {
        url: url.trim(),
        options,
        title: probe?.title,
      });
      setJobs((current) => upsertInternetDownloadEvent(current, event, url.trim()));
      setFeedback("Download iniciado.");
    } catch (err) {
      setFeedback(userFacingError(err, "Não foi possível iniciar o download."));
    } finally {
      setStarting(false);
    }
  };

  const cancelDownload = async (id: string) => {
    try {
      const event = await invoke<InternetDownloadEvent>("internet_download_cancel", { id });
      setJobs((current) => upsertInternetDownloadEvent(current, event, urlRef.current));
      setFeedback(internetDownloadStatusText(event));
    } catch (err) {
      setFeedback(userFacingError(err, "Não foi possível cancelar agora."));
    }
  };

  const closeWindow = () => {
    getCurrentWindow().close().catch(() => {});
  };

  return (
    <div className="downloads-window">
      <header className="downloads-header" data-tauri-drag-region>
        <div className="downloads-title-wrap" data-tauri-drag-region>
          <Download size={17} strokeWidth={2} absoluteStrokeWidth />
          <h1 className="downloads-title">Downloads</h1>
        </div>
        <button
          type="button"
          className="downloads-icon-button"
          title="Fechar"
          aria-label="Fechar"
          onClick={closeWindow}
        >
          <X size={16} strokeWidth={2} absoluteStrokeWidth />
        </button>
      </header>

      <main className="downloads-shell">
        <section className="downloads-compose" aria-label="Novo download">
          <label className="downloads-url-field">
            <span>URL</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Cole um link do YouTube, TikTok, Instagram, X..."
              spellCheck={false}
            />
          </label>

          {probe && (
            <div className="downloads-meta-line">
              <span>{sourceLabel(probe)}</span>
            </div>
          )}

          <div className="downloads-format-row" aria-label="Formato">
            <button
              type="button"
              className={options.format === "mp4" ? "active" : ""}
              onClick={() => setFormat("mp4")}
            >
              <Film size={15} strokeWidth={2} absoluteStrokeWidth />
              MP4
            </button>
            <button
              type="button"
              className={options.format === "mp3" ? "active" : ""}
              onClick={() => setFormat("mp3")}
            >
              <Music size={15} strokeWidth={2} absoluteStrokeWidth />
              MP3
            </button>
          </div>

          {options.format === "mp4" ? (
            <div className="downloads-preset-group" aria-label="Qualidade de vídeo">
              {VIDEO_QUALITIES.map((quality) => {
                const availableVideoQualities = probe?.availableVideoQualities.filter(
                  (value) => value !== "auto",
                ) ?? [];
                const disabled =
                  probeStatus === "ready" &&
                  availableVideoQualities.length > 0 &&
                  !probe?.availableVideoQualities.includes(quality.id);
                return (
                  <button
                    key={quality.id}
                    type="button"
                    className={options.videoQuality === quality.id ? "active" : ""}
                    disabled={disabled}
                    onClick={() =>
                      setOptions((current) =>
                        normalizeInternetDownloadOptions({
                          ...current,
                          videoQuality: quality.id,
                        }),
                      )
                    }
                  >
                    {quality.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="downloads-preset-group" aria-label="Qualidade de áudio">
              {AUDIO_QUALITIES.map((quality) => (
                <button
                  key={quality}
                  type="button"
                  className={options.audioQualityKbps === quality ? "active" : ""}
                  onClick={() =>
                    setOptions((current) =>
                      normalizeInternetDownloadOptions({
                        ...current,
                        audioQualityKbps: quality,
                      }),
                    )
                  }
                >
                  {quality} kbps
                </button>
              ))}
            </div>
          )}

          <div className="downloads-folder-row">
            <div>
              <span>Pasta</span>
              <strong title={options.outputDir ?? "Downloads do Windows"}>
                {options.outputDir ? basename(options.outputDir) : "Downloads do Windows"}
              </strong>
            </div>
            <button
              type="button"
              className="downloads-icon-button"
              title="Escolher pasta"
              aria-label="Escolher pasta"
              onClick={chooseFolder}
            >
              <FolderOpen size={15} strokeWidth={2} absoluteStrokeWidth />
            </button>
            {options.outputDir && (
              <button
                type="button"
                className="downloads-icon-button"
                title="Usar Downloads do Windows"
                aria-label="Usar Downloads do Windows"
                onClick={resetFolder}
              >
                <RotateCcw size={15} strokeWidth={2} absoluteStrokeWidth />
              </button>
            )}
          </div>

          <button
            type="button"
            className={`downloads-primary ${isPreparing ? "loading" : ""}`}
            disabled={!canStart}
            onClick={startDownload}
          >
            {isPreparing ? (
              <LoaderCircle size={16} strokeWidth={2} absoluteStrokeWidth />
            ) : (
              <Download size={16} strokeWidth={2} absoluteStrokeWidth />
            )}
            Baixar
          </button>

          <div
            className={`downloads-feedback ${probeStatus}`}
            aria-live="polite"
            role={probeStatus === "error" ? "alert" : "status"}
          >
            {feedback || fallbackFeedback(url, probeStatus)}
          </div>
        </section>

        <section className="downloads-queue" aria-label="Fila da sessão">
          <div className="downloads-queue-head">
            <span>Fila da sessão</span>
            <small>{jobs.length === 0 ? "Sem downloads" : `${jobs.length} item(ns)`}</small>
          </div>

          {jobs.length === 0 ? (
            <div className="downloads-empty">
              <Download size={18} strokeWidth={2} absoluteStrokeWidth />
              Cole um link, escolha o formato e acompanhe o progresso aqui.
            </div>
          ) : (
            <div className="downloads-job-list">
              {jobs.map((job) => (
                <article className={`downloads-job ${job.status}`} key={job.id}>
                  <div className="downloads-job-top">
                    <div className="downloads-job-title">
                      <strong title={job.title}>{job.title}</strong>
                      <span>{job.stage}</span>
                    </div>
                    {(job.status === "downloading" || job.status === "processing") && (
                      <button
                        type="button"
                        className="downloads-icon-button"
                        title="Cancelar"
                        aria-label="Cancelar"
                        onClick={() => cancelDownload(job.id)}
                      >
                        <X size={14} strokeWidth={2} absoluteStrokeWidth />
                      </button>
                    )}
                  </div>
                  <div className="downloads-progress-track" aria-hidden>
                    <span style={{ width: `${Math.max(0, Math.min(100, job.progressPercent))}%` }} />
                  </div>
                  <div className="downloads-job-foot">
                    <span>{Math.round(job.progressPercent)}%</span>
                    <span>{job.speed || job.message || job.outputPath || "Aguardando"}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
