import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_PATH = "settings.json";
const RECORDING_PREFS_KEY = "recording";

export interface RecordingPrefs {
  includeMicrophone: boolean;
  includeSystemAudio: boolean;
  selectedMicrophone?: string;
}

export const DEFAULT_RECORDING_PREFS: RecordingPrefs = {
  includeMicrophone: true,
  includeSystemAudio: true,
};

const recordingPrefsStore = new LazyStore(STORE_PATH, {
  defaults: {},
  autoSave: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function normalizeRecordingPrefs(
  value: unknown,
  base: RecordingPrefs = DEFAULT_RECORDING_PREFS,
): RecordingPrefs {
  const raw = isRecord(value) ? value : {};
  const selectedMicrophone =
    typeof raw.selectedMicrophone === "string" && raw.selectedMicrophone.trim()
      ? raw.selectedMicrophone.trim()
      : undefined;

  return {
    includeMicrophone:
      typeof raw.includeMicrophone === "boolean"
        ? raw.includeMicrophone
        : base.includeMicrophone,
    includeSystemAudio:
      typeof raw.includeSystemAudio === "boolean"
        ? raw.includeSystemAudio
        : base.includeSystemAudio,
    ...(selectedMicrophone ? { selectedMicrophone } : {}),
  };
}

export async function loadRecordingPrefs(): Promise<RecordingPrefs> {
  try {
    await recordingPrefsStore.init();
    const raw = await recordingPrefsStore.get<RecordingPrefs>(RECORDING_PREFS_KEY);
    return normalizeRecordingPrefs(raw);
  } catch (err) {
    console.warn("[recording-prefs] load failed:", err);
  }
  return { ...DEFAULT_RECORDING_PREFS };
}

export async function saveRecordingPrefs(
  prefs: RecordingPrefs,
): Promise<RecordingPrefs> {
  const next = normalizeRecordingPrefs(prefs);
  try {
    await recordingPrefsStore.init();
    await recordingPrefsStore.set(RECORDING_PREFS_KEY, next);
    await recordingPrefsStore.save();
  } catch (err) {
    console.warn("[recording-prefs] save failed:", err);
  }
  return next;
}
