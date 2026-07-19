export type MediaTransportAction = "playPause" | "next" | "previous";

const MAX_ICON_DATA_URL_LENGTH = 200_000;

export interface MasterVolumeSnapshot {
  volume: number;
  muted: boolean;
}

export interface MicrophoneSnapshot {
  available: boolean;
  muted: boolean;
}

export interface NowPlayingSnapshot {
  title: string;
  artist: string;
  appName: string;
  playbackStatus: "playing" | "paused" | "stopped" | "changing" | "idle" | string;
  canPlay: boolean;
  canPause: boolean;
  canSkipNext: boolean;
  canSkipPrevious: boolean;
  thumbnailDataUrl?: string | null;
}

export interface AppVolumeSnapshot {
  id: string;
  appName: string;
  displayName: string;
  iconDataUrl?: string | null;
  volume: number;
  muted: boolean;
  active: boolean;
}

export interface MediaMixerSnapshot {
  available: boolean;
  message?: string | null;
  master: MasterVolumeSnapshot;
  microphone: MicrophoneSnapshot;
  nowPlaying?: NowPlayingSnapshot | null;
  sessions: AppVolumeSnapshot[];
}

export function clampMixerVolume(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Volume invalido");
  }
  return Math.max(0, Math.min(1, value));
}

export function isMediaTransportAction(
  value: string,
): value is MediaTransportAction {
  return value === "playPause" || value === "next" || value === "previous";
}

export function normalizeMixerSessions(
  sessions: AppVolumeSnapshot[],
): AppVolumeSnapshot[] {
  return sessions
    .filter((session) => session.active && session.id.trim() && session.appName.trim())
    .map((session) => ({
      ...session,
      appName: session.appName.trim(),
      displayName: (session.displayName || session.appName).trim(),
      iconDataUrl: sanitizeIconDataUrl(session.iconDataUrl),
      volume: clampMixerVolume(session.volume),
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, "pt-BR");
    });
}

function sanitizeIconDataUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_ICON_DATA_URL_LENGTH) return null;
  if (trimmed.startsWith("data:image/png;base64,")) return trimmed;
  return null;
}

export function mediaMixerStatusText(snapshot: MediaMixerSnapshot | null): string {
  if (!snapshot) return "Carregando mixer...";
  if (snapshot.message?.trim()) return snapshot.message.trim();
  if (!snapshot.available) return "Controle de midia indisponivel neste Windows.";
  if (!snapshot.nowPlaying && snapshot.sessions.length === 0) return "Nenhum audio ativo agora.";
  return "";
}

export function volumePercent(value: number): number {
  return Math.round(clampMixerVolume(value) * 100);
}
