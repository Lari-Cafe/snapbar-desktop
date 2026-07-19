import { LazyStore } from "@tauri-apps/plugin-store";
import { secureDelete } from "./secure-storage";

const RETIRED_KEYS = [
  "snapbar.google_provider_token",
  "snapbar.google_auth_verifier",
  "snapbar.google_auth_state",
  "snapbar.google_calendar_id",
];

export async function clearRetiredGoogleBackupData(): Promise<void> {
  // ponytail: idempotent cleanup removes values left by pre-removal releases.
  await Promise.all(RETIRED_KEYS.map((key) => secureDelete(key).catch(() => {})));
  const store = new LazyStore("settings.json", { defaults: {}, autoSave: false });
  await store.init();
  await store.delete("backupSettings");
  await store.save();
}