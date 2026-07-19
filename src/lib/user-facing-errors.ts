const TECHNICAL_ERROR_PATTERNS = [
  /ffmpeg/i,
  /ffprobe/i,
  /yt-dlp/i,
  /sendinput/i,
  /resource dir/i,
  /stack trace/i,
  /xcap/i,
  /screenclip/i,
  /spawn/i,
  /status/i,
  /os error/i,
  /enoent/i,
  /eacces/i,
  /panic/i,
  /thread/i,
  /wasapi/i,
  /userprofile/i,
  /mkdir/i,
  /save png/i,
  /monitor/i,
  /clipboard/i,
  /invoke/i,
  /networkerror/i,
  /failed to fetch/i,
  /tauri/i,
];

export function userFacingError(err: unknown, fallback: string): string {
  const message = extractErrorMessage(err);
  if (!message) return fallback;
  if (TECHNICAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return fallback;
  }
  return message;
}

function extractErrorMessage(err: unknown): string {
  if (typeof err === "string") return err.trim();
  if (err instanceof Error) return err.message.trim();
  if (err && typeof err === "object" && "message" in err) {
    const value = (err as { message?: unknown }).message;
    return typeof value === "string" ? value.trim() : "";
  }
  return "";
}
