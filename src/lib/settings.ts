// Persistência de estado da janela (posição, edge, expanded, rotation)
// via tauri-plugin-store. Debounced writes pra não martelar disco no drag.

import { LazyStore } from "@tauri-apps/plugin-store";
import { currentMonitor } from "@tauri-apps/api/window";

export type EdgeState = "none" | "left" | "right" | "top" | "bottom";

export interface WindowState {
  x: number;
  y: number;
  edge: EdgeState;
  expanded: boolean;
  rotation: number;
}

const STORE_PATH = "settings.json";
const STATE_KEY = "window";
const VERSION_KEY = "_version";
const CURRENT_VERSION = 1;
const DEBOUNCE_MS = 250;

// Defaults sem monitor (usados como base; defaults reais via computeDefaults)
const FALLBACK_STATE: WindowState = {
  x: 24,
  y: 24,
  edge: "none",
  expanded: true,
  rotation: 0,
};

// LazyStore: init() acontece no primeiro acesso. autoSave: false porque
// controlamos o save manualmente (debounce + flush).
const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: false });

let cached: WindowState | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const EDGE_VALUES: EdgeState[] = ["none", "left", "right", "top", "bottom"];

function isValidState(value: unknown): value is WindowState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === "number" &&
    Number.isFinite(v.x) &&
    typeof v.y === "number" &&
    Number.isFinite(v.y) &&
    typeof v.rotation === "number" &&
    Number.isFinite(v.rotation) &&
    typeof v.expanded === "boolean" &&
    typeof v.edge === "string" &&
    EDGE_VALUES.includes(v.edge as EdgeState)
  );
}

/**
 * Carrega o estado persistido. Retorna `null` se for first-run ou se o
 * conteúdo está corrompido/ausente — caller deve usar `computeDefaults()`.
 */
export async function loadSettings(): Promise<WindowState | null> {
  try {
    await store.init();
    const raw = await store.get<WindowState>(STATE_KEY);
    if (isValidState(raw)) {
      cached = { ...raw, edge: "none" };
      if (raw.edge !== "none") {
        writeNow(cached).catch((err) => {
          console.warn("[settings] edge migration save failed:", err);
        });
      }
      return cached;
    }
    if (raw !== undefined) {
      console.warn("[settings] invalid state on disk, falling back to defaults", raw);
    }
  } catch (err) {
    console.warn("[settings] load failed:", err);
  }
  cached = null;
  return null;
}

/**
 * Defaults baseados no monitor atual (canto inferior direito com folga pra taskbar).
 */
export async function computeDefaults(
  width = 320,
  height = width,
  taskbarReserve = 48,
): Promise<WindowState> {
  try {
    const mon = await currentMonitor();
    if (mon) {
      const scale = mon.scaleFactor;
      const mw = mon.size.width / scale;
      const mh = mon.size.height / scale;
      const x = Math.max(0, mw - width - 24);
      const y = Math.max(0, mh - height - 24 - taskbarReserve);
      return { x, y, edge: "none", expanded: true, rotation: 0 };
    }
  } catch (err) {
    console.warn("[settings] computeDefaults failed:", err);
  }
  return { ...FALLBACK_STATE };
}

/**
 * Clampa a posição (x,y) dentro do monitor atual, considerando o tamanho
 * que a janela vai ter naquele estado (width/height). Cobre o caso "salvei
 * num monitor que agora não existe / mudou resolução".
 */
export async function clampToMonitor(
  state: WindowState,
  width: number,
  height: number,
  taskbarReserve = 48
): Promise<WindowState> {
  try {
    const mon = await currentMonitor();
    if (!mon) return state;
    const scale = mon.scaleFactor;
    const mw = mon.size.width / scale;
    const mh = mon.size.height / scale;
    const maxX = Math.max(0, mw - width);
    const maxY = Math.max(0, mh - height - taskbarReserve);
    return {
      ...state,
      x: Math.max(0, Math.min(maxX, state.x)),
      y: Math.max(0, Math.min(maxY, state.y)),
    };
  } catch (err) {
    console.warn("[settings] clampToMonitor failed:", err);
    return state;
  }
}

/**
 * Salva parcial do estado, mesclando com o último cache. Debounced 250ms.
 * Múltiplas chamadas dentro da janela colapsam em um único write.
 */
export function saveWindowState(patch: Partial<WindowState>): void {
  const base = cached ?? FALLBACK_STATE;
  cached = { ...base, ...patch };
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    writeNow(cached!).catch((err) => {
      console.warn("[settings] save failed:", err);
    });
  }, DEBOUNCE_MS);
}

/**
 * Força gravação imediata, cancelando qualquer debounce pendente.
 * Use antes de hide-to-tray ou quit.
 */
export async function flushSettings(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (!cached) return;
  try {
    await writeNow(cached);
  } catch (err) {
    console.warn("[settings] flush failed:", err);
  }
}

async function writeNow(state: WindowState): Promise<void> {
  await store.set(STATE_KEY, state);
  await store.set(VERSION_KEY, CURRENT_VERSION);
  await store.save();
}
