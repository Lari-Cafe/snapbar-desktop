import { invoke } from "@tauri-apps/api/core";

function hasTauriInternals(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function secureGet(key: string): Promise<string | null> {
  if (!hasTauriInternals()) return null;
  return invoke<string | null>("secure_store_get", { key });
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (!hasTauriInternals()) return;
  await invoke("secure_store_set", { key, value });
}

export async function secureDelete(key: string): Promise<void> {
  if (!hasTauriInternals()) return;
  await invoke("secure_store_delete", { key });
}
