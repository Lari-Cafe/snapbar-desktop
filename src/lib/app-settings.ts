// Persistencia das configuracoes do app: comportamento da janela e atalhos.
// Compartilha o mesmo arquivo `settings.json` da WindowState (chaves separadas).

import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_PATH = "settings.json";
const BEHAVIOR_KEY = "behavior";
const SHORTCUTS_KEY = "shortcuts";
const OUTPUT_PATHS_KEY = "outputPaths";
const TYPO_FIRE_SETTINGS_KEY = "typoFireSettings";
const TYPO_FIRE_MATCHES_KEY = "typoFireMatches";
const DIAGNOSTICS_KEY = "diagnostics";

const APPEARANCE_KEY = "appearance";

export type ShortcutAction =
  | "toggle_toolbar"
  | "toggle_expanded"
  | "capture"
  | "toggle_recording"
  | "toggle_dictation"
  | "open_settings"
  | "open_mixer"
  | "open_todo_calendar"
  | "open_pomodoro"
  | "pomodoro_start_pause"
  | "quick_add_todo"
  | "media_play_pause"
  | "media_next"
  | "media_previous"
  | "media_mute"
  | "typo_fire_toggle"
  | "typo_fire_search"
  | "typo_fire_reload";

export interface BehaviorSettings {
  alwaysOnTop: boolean;
  inactiveOpacity: number; // 10..100
  autoHide: boolean;
  toolbarSizeMode: ToolbarSizeMode;
  toolbarOrientation: ToolbarOrientation;
}

export type ToolbarSizeMode = "auto" | "default" | "compact" | "mini";
export type ToolbarOrientation = "horizontal" | "vertical";
export type ShortcutMap = Partial<Record<ShortcutAction, string>>;

export interface OutputPathSettings {
  screenshotDir?: string;
  recordingDir?: string;
  internetDownloadDir?: string;
}

export interface DiagnosticsSettings {
  detailedLogs: boolean;
}


export type VisualPreset = "default" | "liquidGlass";
export type GlassIntensity = "soft" | "medium" | "strong";
export type ToolbarShape = "dock" | "donutLegacy" | "iconBar" | "expandableTabs";

export interface WallpaperSettings {
  enabled: boolean;
  path: string;
  dim: number; // 0..85
  blur: number; // 0..40
}

export interface AppearanceGlassSettings {
  blur: number; // 0..80
  saturation: number; // 80..260
  opacity: number; // 20..100
  radius: number; // 4..999, legacy usa formato circular
  border: number; // 0..100
  highlight: number; // 0..100
  shadow: number; // 0..100
}

export interface AppearanceMotionSettings {
  enabled: boolean;
  speed: number; // 50..160
  stagger: number; // 0..140
  morph: number; // 0..100
}

export interface AppearanceSettings {
  preset: VisualPreset;
  toolbarShape: ToolbarShape;
  accentColor: string;
  glassIntensity: GlassIntensity;
  glass: AppearanceGlassSettings;
  wallpaper: WallpaperSettings;
  motion: AppearanceMotionSettings;
}

export type TypoFireTriggerMode = "suffix" | "word";
export type TypoFireBackend = "clipboard";
export type TypoFireMatchType = "literal" | "regex";
export type TypoFireAppFilterMode = "disabled" | "include" | "exclude";

export interface TypoFireAppFilters {
  mode: TypoFireAppFilterMode;
  entries: string[];
}

export interface TypoFireSettings {
  enabled: boolean;
  prefix: string;
  triggerMode: TypoFireTriggerMode;
  backend: TypoFireBackend;
  searchShortcut: string;
  toggleShortcut: string;
  undoBackspace: boolean;
  allowScripts: boolean;
  appFilters: TypoFireAppFilters;
}

export interface TypoFireVariable {
  name: string;
  kind: "date" | "time";
  format?: string;
}

export interface TypoFireFormField {
  name: string;
  label: string;
  fieldType: "text" | "select" | "choice";
  options: string[];
}

export interface TypoFireMatch {
  id: string;
  label: string;
  triggers: string[];
  replace: string;
  matchType: TypoFireMatchType;
  variables: TypoFireVariable[];
  formFields: TypoFireFormField[];
  appFilters: TypoFireAppFilters;
  enabled: boolean;
  favorite: boolean;
}

export const DEFAULT_BEHAVIOR: BehaviorSettings = {
  alwaysOnTop: true,
  inactiveOpacity: 100,
  autoHide: false,
  toolbarSizeMode: "compact",
  toolbarOrientation: "horizontal",
};

export const DEFAULT_SHORTCUTS: ShortcutMap = {};
export const DEFAULT_OUTPUT_PATHS: OutputPathSettings = {};
export const DEFAULT_DIAGNOSTICS_SETTINGS: DiagnosticsSettings = {
  detailedLogs: false,
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  preset: "default",
  toolbarShape: "donutLegacy",
  accentColor: "#27272a",
  glassIntensity: "medium",
  glass: {
    blur: 18,
    saturation: 120,
    opacity: 92,
    radius: 22,
    border: 18,
    highlight: 24,
    shadow: 0,
  },
  wallpaper: {
    enabled: false,
    path: "",
    dim: 28,
    blur: 0,
  },
  motion: {
    enabled: true,
    speed: 92,
    stagger: 18,
    morph: 36,
  },
};
export const DEFAULT_TYPO_FIRE_SETTINGS: TypoFireSettings = {
  enabled: true,
  prefix: "/",
  triggerMode: "suffix",
  backend: "clipboard",
  searchShortcut: "",
  toggleShortcut: "",
  undoBackspace: true,
  allowScripts: false,
  appFilters: {
    mode: "disabled",
    entries: [],
  },
};
export const DEFAULT_TYPO_FIRE_MATCHES: TypoFireMatch[] = [
  {
    id: "default-oi",
    label: "Oi",
    triggers: ["/oi"],
    replace: "ola tudo bem com vc? ",
    matchType: "literal",
    variables: [],
    formFields: [],
    appFilters: {
      mode: "disabled",
      entries: [],
    },
    enabled: true,
    favorite: true,
  },
];

export const SHORTCUT_ACTIONS: { id: ShortcutAction; label: string; hint: string }[] = [
  { id: "toggle_toolbar", label: "Mostrar/ocultar toolbar", hint: "Traz a toolbar de volta do tray" },
  { id: "toggle_expanded", label: "Expandir/recolher toolbar", hint: "Alterna entre a barra e o quadrado" },
  { id: "capture", label: "Tirar print", hint: "Abre o recorte do Windows" },
  { id: "toggle_recording", label: "Iniciar/parar gravação", hint: "Alterna a gravação de tela" },
  { id: "toggle_dictation", label: "Digitação por voz", hint: "Aciona o Win+H do Windows" },
  { id: "open_settings", label: "Abrir configurações", hint: "Abre esta janela" },
  { id: "open_mixer", label: "Abrir mixer", hint: "Mostra volume e controles de mídia" },
  { id: "open_todo_calendar", label: "Abrir calendário", hint: "Abre o To-do Calendar" },
  { id: "open_pomodoro", label: "Abrir pomodoro", hint: "Abre o timer Pomodoro" },
  { id: "pomodoro_start_pause", label: "Pomodoro: iniciar/pausar", hint: "Alterna o timer de foco" },
  { id: "quick_add_todo", label: "Tarefa rápida", hint: "Abre calendário para adicionar" },
  { id: "media_play_pause", label: "Mídia: play/pause", hint: "Alterna reprodução do app ativo" },
  { id: "media_next", label: "Mídia: próxima", hint: "Pula para a próxima faixa quando disponível" },
  { id: "media_previous", label: "Mídia: anterior", hint: "Volta para a faixa anterior quando disponível" },
  { id: "media_mute", label: "Mídia: mute geral", hint: "Alterna o mute do volume geral do Windows" },
  { id: "typo_fire_toggle", label: "Typo Fire: ligar/desligar", hint: "Pausa ou retoma as expansões de texto" },
  { id: "typo_fire_search", label: "Typo Fire: buscar match", hint: "Abre a busca de expansões" },
  { id: "typo_fire_reload", label: "Typo Fire: recarregar", hint: "Recarrega matches e configurações" },
];

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: false });

let behaviorCache: BehaviorSettings | null = null;
let shortcutsCache: ShortcutMap | null = null;
let outputPathsCache: OutputPathSettings | null = null;
let typoFireSettingsCache: TypoFireSettings | null = null;
let typoFireMatchesCache: TypoFireMatch[] | null = null;
let diagnosticsCache: DiagnosticsSettings | null = null;

let appearanceCache: AppearanceSettings | null = null;

function isBehavior(value: unknown): value is BehaviorSettings {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.alwaysOnTop === "boolean" &&
    typeof v.inactiveOpacity === "number" &&
    Number.isFinite(v.inactiveOpacity) &&
    v.inactiveOpacity >= 10 &&
    v.inactiveOpacity <= 100 &&
    typeof v.autoHide === "boolean" &&
    (v.toolbarSizeMode === undefined || isToolbarSizeMode(v.toolbarSizeMode)) &&
    (v.toolbarOrientation === undefined || isToolbarOrientation(v.toolbarOrientation))
  );
}

function isToolbarSizeMode(value: unknown): value is ToolbarSizeMode {
  return (
    value === "auto" ||
    value === "default" ||
    value === "compact" ||
    value === "mini"
  );
}

function isToolbarOrientation(value: unknown): value is ToolbarOrientation {
  return value === "horizontal" || value === "vertical";
}

function isShortcutMap(value: unknown): value is ShortcutMap {
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(
    (v) => typeof v === "string"
  );
}

function isOutputPathSettings(value: unknown): value is OutputPathSettings {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.screenshotDir === undefined || typeof v.screenshotDir === "string") &&
    (v.recordingDir === undefined || typeof v.recordingDir === "string") &&
    (v.internetDownloadDir === undefined ||
      typeof v.internetDownloadDir === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function isVisualPreset(value: unknown): value is VisualPreset {
  return value === "default" || value === "liquidGlass";
}

function normalizeVisualPreset(value: unknown, fallback: VisualPreset): VisualPreset {
  if (isVisualPreset(value)) return value;
  if (value === "cleanCorp" || value === "cleanCorpDark" || value === "legacy" || value === "custom") {
    return "default";
  }
  return fallback;
}

function normalizeGlassIntensity(value: unknown, fallback: GlassIntensity): GlassIntensity {
  return value === "soft" || value === "medium" || value === "strong" ? value : fallback;
}

function glassForIntensity(intensity: GlassIntensity): AppearanceGlassSettings {
  if (intensity === "soft") {
    return { blur: 18, saturation: 135, opacity: 84, radius: 22, border: 18, highlight: 28, shadow: 0 };
  }
  if (intensity === "strong") {
    return { blur: 42, saturation: 190, opacity: 62, radius: 24, border: 42, highlight: 58, shadow: 0 };
  }
  return { blur: 30, saturation: 165, opacity: 72, radius: 22, border: 30, highlight: 44, shadow: 0 };
}

function normalizeAccentColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed) || /^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

export function normalizeTypoFireAppFilters(value: unknown): TypoFireAppFilters {
  const raw = isRecord(value) ? value : {};
  const mode =
    raw.mode === "include" || raw.mode === "exclude" || raw.mode === "disabled"
      ? raw.mode
      : "disabled";
  return {
    mode,
    entries: normalizeStringList(raw.entries),
  };
}

export function normalizeTypoFireSettings(
  value: Partial<TypoFireSettings> | Record<string, unknown>,
  base: TypoFireSettings = DEFAULT_TYPO_FIRE_SETTINGS,
): TypoFireSettings {
  const raw = isRecord(value) ? value : {};
  const triggerMode = raw.triggerMode === "word" ? "word" : base.triggerMode;
  const backend = raw.backend === "clipboard" ? "clipboard" : base.backend;
  const rawPrefix =
    typeof raw.prefix === "string" && raw.prefix.trim()
      ? raw.prefix.trim()
      : base.prefix;
  const prefix = sanitizeTypoFirePrefix(rawPrefix);

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    prefix,
    triggerMode,
    backend,
    searchShortcut: typeof raw.searchShortcut === "string" ? raw.searchShortcut.trim() : base.searchShortcut,
    toggleShortcut: typeof raw.toggleShortcut === "string" ? raw.toggleShortcut.trim() : base.toggleShortcut,
    undoBackspace: typeof raw.undoBackspace === "boolean" ? raw.undoBackspace : base.undoBackspace,
    allowScripts: false,
    appFilters: normalizeTypoFireAppFilters(raw.appFilters ?? base.appFilters),
  };
}

export function sanitizeTypoFirePrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "/";
  if (trimmed.includes("/")) return "/";
  return trimmed[0] ?? "/";
}

export function normalizeTypoFireMatches(value: unknown): TypoFireMatch[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): TypoFireMatch[] => {
    if (!isRecord(entry)) return [];
    const triggers = normalizeStringList(entry.triggers);
    const replace = typeof entry.replace === "string" ? entry.replace : "";
    if (triggers.length === 0 || !replace) return [];

    const id =
      typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : `match-${crypto.randomUUID()}`;
    const label =
      typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim()
        : triggers[0];
    const matchType = entry.matchType === "regex" ? "regex" : "literal";

    return [
      {
        id,
        label,
        triggers,
        replace,
        matchType,
        variables: [],
        formFields: [],
        appFilters: normalizeTypoFireAppFilters(entry.appFilters),
        enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
        favorite: typeof entry.favorite === "boolean" ? entry.favorite : false,
      },
    ];
  });
}

export function normalizeOutputPaths(value: OutputPathSettings): OutputPathSettings {
  const next: OutputPathSettings = {};
  const screenshotDir = value.screenshotDir?.trim();
  const recordingDir = value.recordingDir?.trim();
  const internetDownloadDir = value.internetDownloadDir?.trim();
  if (screenshotDir) next.screenshotDir = screenshotDir;
  if (recordingDir) next.recordingDir = recordingDir;
  if (internetDownloadDir) next.internetDownloadDir = internetDownloadDir;
  return next;
}

export function normalizeDiagnosticsSettings(
  value: Partial<DiagnosticsSettings> | Record<string, unknown>,
  base: DiagnosticsSettings = DEFAULT_DIAGNOSTICS_SETTINGS,
): DiagnosticsSettings {
  const raw = isRecord(value) ? value : {};
  return {
    detailedLogs:
      typeof raw.detailedLogs === "boolean"
        ? raw.detailedLogs
        : base.detailedLogs,
  };
}


export function appearanceForPreset(
  preset: VisualPreset,
  current: AppearanceSettings = DEFAULT_APPEARANCE_SETTINGS,
): AppearanceSettings {
  if (preset === "default") {
    return {
      ...current,
      preset: "default",
      toolbarShape: "donutLegacy",
      accentColor: "#27272a",
      glass: { ...DEFAULT_APPEARANCE_SETTINGS.glass },
      motion: {
        enabled: current.motion.enabled,
        speed: 92,
        stagger: 18,
        morph: 36,
      },
    };
  }

  return {
    ...current,
    preset: "liquidGlass",
    toolbarShape: "donutLegacy",
    accentColor: "#e5e7eb",
    glass: glassForIntensity(current.glassIntensity),
    motion: {
      enabled: current.motion.enabled,
      speed: 100,
      stagger: 38,
      morph: 82,
    },
  };
}

export function normalizeAppearanceSettings(
  value: Partial<AppearanceSettings> | Record<string, unknown>,
  base: AppearanceSettings = DEFAULT_APPEARANCE_SETTINGS,
): AppearanceSettings {
  const raw = isRecord(value) ? value : {};
  const rawGlass = isRecord(raw.glass) ? raw.glass : {};
  const rawWallpaper = isRecord(raw.wallpaper) ? raw.wallpaper : {};
  const rawMotion = isRecord(raw.motion) ? raw.motion : {};
  const preset = normalizeVisualPreset(raw.preset, base.preset);
  const glassIntensity = normalizeGlassIntensity(raw.glassIntensity, base.glassIntensity);

  return {
    preset,
    toolbarShape: "donutLegacy",
    accentColor: normalizeAccentColor(raw.accentColor, base.accentColor),
    glassIntensity,
    glass: {
      blur: clampNumber(rawGlass.blur, 0, 80, base.glass.blur),
      saturation: clampNumber(rawGlass.saturation, 80, 260, base.glass.saturation),
      opacity: clampNumber(rawGlass.opacity, 20, 100, base.glass.opacity),
      radius: clampNumber(rawGlass.radius, 4, 999, base.glass.radius),
      border: clampNumber(rawGlass.border, 0, 100, base.glass.border),
      highlight: clampNumber(rawGlass.highlight, 0, 100, base.glass.highlight),
      shadow: clampNumber(rawGlass.shadow, 0, 100, base.glass.shadow),
    },
    wallpaper: {
      enabled: typeof rawWallpaper.enabled === "boolean" ? rawWallpaper.enabled : base.wallpaper.enabled,
      path: typeof rawWallpaper.path === "string" ? rawWallpaper.path.trim() : base.wallpaper.path,
      dim: clampNumber(rawWallpaper.dim, 0, 85, base.wallpaper.dim),
      blur: clampNumber(rawWallpaper.blur, 0, 40, base.wallpaper.blur),
    },
    motion: {
      enabled: typeof rawMotion.enabled === "boolean" ? rawMotion.enabled : base.motion.enabled,
      speed: clampNumber(rawMotion.speed, 50, 160, base.motion.speed),
      stagger: clampNumber(rawMotion.stagger, 0, 140, base.motion.stagger),
      morph: clampNumber(rawMotion.morph, 0, 100, base.motion.morph),
    },
  };
}

export function normalizeBehaviorSettings(
  value: Partial<BehaviorSettings> | Record<string, unknown>,
  base: BehaviorSettings = DEFAULT_BEHAVIOR,
): BehaviorSettings {
  const raw = isRecord(value) ? value : {};
  const rawOpacity =
    typeof raw.inactiveOpacity === "number" && Number.isFinite(raw.inactiveOpacity)
      ? raw.inactiveOpacity
      : base.inactiveOpacity;
  const steppedOpacity = Math.round(rawOpacity / 5) * 5;

  return {
    alwaysOnTop: typeof raw.alwaysOnTop === "boolean" ? raw.alwaysOnTop : base.alwaysOnTop,
    inactiveOpacity: Math.max(10, Math.min(100, steppedOpacity)),
    autoHide: typeof raw.autoHide === "boolean" ? raw.autoHide : base.autoHide,
    toolbarSizeMode: isToolbarSizeMode(raw.toolbarSizeMode)
      ? raw.toolbarSizeMode
      : base.toolbarSizeMode,
    toolbarOrientation: isToolbarOrientation(raw.toolbarOrientation)
      ? raw.toolbarOrientation
      : base.toolbarOrientation,
  };
}

export async function loadBehavior(): Promise<BehaviorSettings> {
  if (behaviorCache) return behaviorCache;
  try {
    await store.init();
    const raw = await store.get<BehaviorSettings>(BEHAVIOR_KEY);
    if (isBehavior(raw) || isRecord(raw)) {
      behaviorCache = normalizeBehaviorSettings(raw);
      return behaviorCache;
    }
  } catch (err) {
    console.warn("[app-settings] loadBehavior failed:", err);
  }
  behaviorCache = { ...DEFAULT_BEHAVIOR };
  return behaviorCache;
}

export async function saveBehavior(patch: Partial<BehaviorSettings>): Promise<BehaviorSettings> {
  const current = behaviorCache ?? (await loadBehavior());
  const next = normalizeBehaviorSettings(patch, current);
  behaviorCache = next;
  try {
    await store.init();
    await store.set(BEHAVIOR_KEY, next);
    await store.save();
  } catch (err) {
    console.warn("[app-settings] saveBehavior failed:", err);
  }
  return next;
}

export async function loadShortcuts(): Promise<ShortcutMap> {
  if (shortcutsCache) return shortcutsCache;
  try {
    await store.init();
    const raw = await store.get<ShortcutMap>(SHORTCUTS_KEY);
    if (isShortcutMap(raw)) {
      shortcutsCache = raw;
      return raw;
    }
  } catch (err) {
    console.warn("[app-settings] loadShortcuts failed:", err);
  }
  shortcutsCache = { ...DEFAULT_SHORTCUTS };
  return shortcutsCache;
}

export async function loadOutputPaths(): Promise<OutputPathSettings> {
  if (outputPathsCache) return outputPathsCache;
  try {
    await store.init();
    const raw = await store.get<OutputPathSettings>(OUTPUT_PATHS_KEY);
    if (isOutputPathSettings(raw)) {
      outputPathsCache = normalizeOutputPaths(raw);
      return outputPathsCache;
    }
  } catch (err) {
    console.warn("[app-settings] loadOutputPaths failed:", err);
  }
  outputPathsCache = { ...DEFAULT_OUTPUT_PATHS };
  return outputPathsCache;
}

export async function loadDiagnosticsSettings(): Promise<DiagnosticsSettings> {
  if (diagnosticsCache) return diagnosticsCache;
  try {
    await store.init();
    const raw = await store.get<DiagnosticsSettings>(DIAGNOSTICS_KEY);
    diagnosticsCache = normalizeDiagnosticsSettings(raw ?? {});
    return diagnosticsCache;
  } catch (err) {
    console.warn("[app-settings] loadDiagnosticsSettings failed:", err);
  }
  diagnosticsCache = { ...DEFAULT_DIAGNOSTICS_SETTINGS };
  return diagnosticsCache;
}


export async function loadAppearanceSettings(): Promise<AppearanceSettings> {
  if (appearanceCache) return appearanceCache;
  try {
    await store.init();
    const raw = await store.get<AppearanceSettings>(APPEARANCE_KEY);
    appearanceCache = normalizeAppearanceSettings(raw ?? {});
    return appearanceCache;
  } catch (err) {
    console.warn("[app-settings] loadAppearanceSettings failed:", err);
  }
  appearanceCache = { ...DEFAULT_APPEARANCE_SETTINGS };
  return appearanceCache;
}


export async function saveAppearanceSettings(
  patch: Partial<AppearanceSettings>,
): Promise<AppearanceSettings> {
  const current = appearanceCache ?? (await loadAppearanceSettings());
  const next = normalizeAppearanceSettings({ ...current, ...patch }, current);
  appearanceCache = next;
  try {
    await store.init();
    await store.set(APPEARANCE_KEY, next);
    await store.save();
  } catch (err) {
    console.warn("[app-settings] saveAppearanceSettings failed:", err);
  }
  return next;
}

export async function saveDiagnosticsSettings(
  patch: Partial<DiagnosticsSettings>,
): Promise<DiagnosticsSettings> {
  const current = diagnosticsCache ?? (await loadDiagnosticsSettings());
  const next = normalizeDiagnosticsSettings({ ...current, ...patch }, current);
  diagnosticsCache = next;
  try {
    await store.init();
    await store.set(DIAGNOSTICS_KEY, next);
    await store.save();
  } catch (err) {
    console.warn("[app-settings] saveDiagnosticsSettings failed:", err);
  }
  return next;
}

export async function saveOutputPaths(
  patch: Partial<OutputPathSettings>,
): Promise<OutputPathSettings> {
  const current = outputPathsCache ?? (await loadOutputPaths());
  const next = normalizeOutputPaths({ ...current, ...patch });
  outputPathsCache = next;
  try {
    await store.init();
    await store.set(OUTPUT_PATHS_KEY, next);
    await store.save();
  } catch (err) {
    console.warn("[app-settings] saveOutputPaths failed:", err);
  }
  return next;
}

export async function loadTypoFireSettings(): Promise<TypoFireSettings> {
  if (typoFireSettingsCache) return typoFireSettingsCache;
  try {
    await store.init();
    const raw = await store.get<TypoFireSettings>(TYPO_FIRE_SETTINGS_KEY);
    typoFireSettingsCache = normalizeTypoFireSettings(raw ?? {});
    return typoFireSettingsCache;
  } catch (err) {
    console.warn("[app-settings] loadTypoFireSettings failed:", err);
  }
  typoFireSettingsCache = { ...DEFAULT_TYPO_FIRE_SETTINGS };
  return typoFireSettingsCache;
}

export async function saveTypoFireSettings(
  patch: Partial<TypoFireSettings>,
): Promise<TypoFireSettings> {
  const current = typoFireSettingsCache ?? (await loadTypoFireSettings());
  const next = normalizeTypoFireSettings({ ...current, ...patch }, current);
  typoFireSettingsCache = next;
  try {
    await store.init();
    await store.set(TYPO_FIRE_SETTINGS_KEY, next);
    await store.save();
  } catch (err) {
    console.warn("[app-settings] saveTypoFireSettings failed:", err);
  }
  return next;
}

export async function loadTypoFireMatches(): Promise<TypoFireMatch[]> {
  if (typoFireMatchesCache) return typoFireMatchesCache;
  try {
    await store.init();
    const raw = await store.get<TypoFireMatch[]>(TYPO_FIRE_MATCHES_KEY);
    typoFireMatchesCache =
      raw === undefined ? [...DEFAULT_TYPO_FIRE_MATCHES] : normalizeTypoFireMatches(raw);
    return typoFireMatchesCache;
  } catch (err) {
    console.warn("[app-settings] loadTypoFireMatches failed:", err);
  }
  typoFireMatchesCache = [...DEFAULT_TYPO_FIRE_MATCHES];
  return typoFireMatchesCache;
}

export async function saveTypoFireMatches(matches: TypoFireMatch[]): Promise<TypoFireMatch[]> {
  const next = normalizeTypoFireMatches(matches);
  typoFireMatchesCache = next;
  try {
    await store.init();
    await store.set(TYPO_FIRE_MATCHES_KEY, next);
    await store.save();
  } catch (err) {
    console.warn("[app-settings] saveTypoFireMatches failed:", err);
  }
  return next;
}

export async function saveShortcut(action: ShortcutAction, accelerator: string | null): Promise<ShortcutMap> {
  const current = shortcutsCache ?? (await loadShortcuts());
  const next: ShortcutMap = { ...current };
  if (accelerator) {
    next[action] = accelerator;
  } else {
    delete next[action];
  }
  shortcutsCache = next;
  try {
    await store.init();
    await store.set(SHORTCUTS_KEY, next);
    await store.save();
  } catch (err) {
    console.warn("[app-settings] saveShortcut failed:", err);
  }
  return next;
}

export async function saveShortcuts(shortcuts: ShortcutMap): Promise<ShortcutMap> {
  const next: ShortcutMap = {};
  for (const action of SHORTCUT_ACTIONS) {
    const accelerator = shortcuts[action.id];
    if (typeof accelerator === "string" && accelerator.trim()) {
      next[action.id] = accelerator.trim();
    }
  }
  shortcutsCache = next;
  try {
    await store.init();
    await store.set(SHORTCUTS_KEY, next);
    await store.save();
  } catch (err) {
    console.warn("[app-settings] saveShortcuts failed:", err);
  }
  return next;
}

export async function resetAllSettings(): Promise<void> {
  behaviorCache = { ...DEFAULT_BEHAVIOR };
  shortcutsCache = { ...DEFAULT_SHORTCUTS };
  outputPathsCache = { ...DEFAULT_OUTPUT_PATHS };
  typoFireSettingsCache = { ...DEFAULT_TYPO_FIRE_SETTINGS };
  typoFireMatchesCache = [...DEFAULT_TYPO_FIRE_MATCHES];
  diagnosticsCache = { ...DEFAULT_DIAGNOSTICS_SETTINGS };

  appearanceCache = { ...DEFAULT_APPEARANCE_SETTINGS };
  try {
    await store.init();
    await store.set(BEHAVIOR_KEY, DEFAULT_BEHAVIOR);
    await store.set(SHORTCUTS_KEY, DEFAULT_SHORTCUTS);
    await store.set(OUTPUT_PATHS_KEY, DEFAULT_OUTPUT_PATHS);
    await store.delete("speech");
    await store.set(TYPO_FIRE_SETTINGS_KEY, DEFAULT_TYPO_FIRE_SETTINGS);
    await store.set(TYPO_FIRE_MATCHES_KEY, DEFAULT_TYPO_FIRE_MATCHES);
    await store.set(DIAGNOSTICS_KEY, DEFAULT_DIAGNOSTICS_SETTINGS);

    await store.set(APPEARANCE_KEY, DEFAULT_APPEARANCE_SETTINGS);
    await store.delete("window");
    await store.save();
  } catch (err) {
    console.warn("[app-settings] resetAllSettings failed:", err);
  }
}

export function clearAppSettingsCache(): void {
  behaviorCache = null;
  shortcutsCache = null;
  outputPathsCache = null;
  typoFireSettingsCache = null;
  typoFireMatchesCache = null;
  diagnosticsCache = null;

  appearanceCache = null;
}
