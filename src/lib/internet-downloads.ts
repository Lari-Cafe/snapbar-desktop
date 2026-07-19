export type InternetDownloadFormat = "mp4" | "mp3";
export type VideoQualityPreset = "auto" | "1080p" | "720p" | "480p";
export type SelectableVideoQualityPreset = Exclude<VideoQualityPreset, "auto">;
export type AudioQualityKbps = 128 | 192 | 320;
export type InternetDownloadStatus =
  | "queued"
  | "probing"
  | "downloading"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface InternetDownloadOptions {
  format: InternetDownloadFormat;
  videoQuality: VideoQualityPreset;
  audioQualityKbps: AudioQualityKbps;
  outputDir?: string;
}

export interface InternetDownloadJob {
  id: string;
  url: string;
  title: string;
  status: InternetDownloadStatus;
  progressPercent: number;
  speed: string;
  stage: string;
  outputPath?: string;
  message?: string;
  hardwareAcceleration?: "gpu" | "cpu";
}

export interface InternetDownloadEvent {
  id: string;
  status: InternetDownloadStatus;
  title?: string;
  url?: string;
  progressPercent?: number;
  speed?: string;
  stage?: string;
  outputPath?: string;
  message?: string;
  hardwareAcceleration?: "gpu" | "cpu";
}

export interface InternetDownloadProbeResult {
  title: string;
  source: string;
  durationSeconds?: number;
  thumbnail?: string;
  availableVideoQualities: VideoQualityPreset[];
  hardwareAcceleration: "gpu" | "cpu";
  message?: string;
}

export const DEFAULT_INTERNET_DOWNLOAD_OPTIONS: InternetDownloadOptions = {
  format: "mp4",
  videoQuality: "1080p",
  audioQualityKbps: 192,
  outputDir: undefined,
};

const SELECTABLE_VIDEO_QUALITIES: SelectableVideoQualityPreset[] = [
  "1080p",
  "720p",
  "480p",
];

export function normalizeInternetDownloadOptions(
  value: Partial<InternetDownloadOptions>,
): InternetDownloadOptions {
  return {
    format: value.format === "mp3" ? "mp3" : "mp4",
    videoQuality: isVideoQualityPreset(value.videoQuality)
      ? value.videoQuality
      : "1080p",
    audioQualityKbps: isAudioQualityKbps(value.audioQualityKbps)
      ? value.audioQualityKbps
      : 192,
    outputDir: normalizeOptionalPath(value.outputDir),
  };
}

export function canAnalyzeDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function applyInternetDownloadEvent(
  jobs: InternetDownloadJob[],
  event: InternetDownloadEvent,
): InternetDownloadJob[] {
  return jobs.map((job) =>
    job.id === event.id
      ? {
          ...job,
          ...event,
          url: event.url?.trim() ? event.url : job.url,
          title: event.title?.trim() ? event.title : job.title,
          progressPercent: event.progressPercent ?? job.progressPercent,
          speed: event.speed ?? job.speed,
          stage: event.stage ?? job.stage,
        }
      : job,
  );
}

export function internetDownloadJobFromEvent(
  event: InternetDownloadEvent,
  fallbackUrl: string,
): InternetDownloadJob {
  return {
    id: event.id,
    url: event.url?.trim() ? event.url : fallbackUrl,
    title: event.title?.trim() ? event.title : "Download",
    status: event.status,
    progressPercent: event.progressPercent ?? 0,
    speed: event.speed ?? "",
    stage: event.stage ?? "Baixando",
    outputPath: event.outputPath,
    message: event.message,
    hardwareAcceleration: event.hardwareAcceleration,
  };
}

export function upsertInternetDownloadEvent(
  jobs: InternetDownloadJob[],
  event: InternetDownloadEvent,
  fallbackUrl: string,
): InternetDownloadJob[] {
  if (jobs.some((job) => job.id === event.id)) {
    return applyInternetDownloadEvent(jobs, event);
  }
  return [internetDownloadJobFromEvent(event, fallbackUrl), ...jobs];
}

export function bestSelectableVideoQuality(
  available: VideoQualityPreset[],
): SelectableVideoQualityPreset {
  return (
    SELECTABLE_VIDEO_QUALITIES.find((quality) => available.includes(quality)) ??
    "1080p"
  );
}

export function internetDownloadStatusText(
  event: Pick<InternetDownloadEvent, "status" | "outputPath" | "message">,
): string {
  if (event.status === "completed" && event.outputPath) {
    return `Salvo em: ${event.outputPath}`;
  }
  if (event.status === "failed") {
    return event.message ?? "Nao foi possivel baixar este link.";
  }
  if (event.status === "cancelled") {
    return "Download cancelado.";
  }
  return event.message ?? "";
}

function isVideoQualityPreset(value: unknown): value is VideoQualityPreset {
  return value === "auto" || value === "1080p" || value === "720p" || value === "480p";
}

function isAudioQualityKbps(value: unknown): value is AudioQualityKbps {
  return value === 128 || value === 192 || value === 320;
}

function normalizeOptionalPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
