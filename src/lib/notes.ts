// Persistencia das notas flutuantes (sticky notes).
// Cada nota vira uma janela propria; aqui guardamos o conteudo, a cor e a
// geometria (posicao/tamanho) no mesmo arquivo `settings.json`, sob a chave
// `notes`. Tudo local, sem nuvem e com privacidade por padrao.

import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_PATH = "settings.json";
const NOTES_KEY = "notes";
export const NOTES_CHANGED_EVENT = "notes://changed";

export type NoteColor = "yellow" | "green" | "blue" | "pink" | "purple";

export interface Note {
  id: string;
  content: string;
  // Cor base da nota em hex (#rrggbb). Escolhida pela roda de cores ou pelos
  // atalhos de cor. Versoes antigas usavam nomes (yellow/green/...): tratamos
  // isso na normalizacao para nao perder notas ja salvas.
  color: string;
  // Campo legado mantido para ler notas antigas sem quebrar o arquivo salvo.
  gradient: boolean;
  // Opacidade do fundo da nota (0.4..1). O texto continua nitido.
  opacity: number;
  // Tamanho da fonte do texto (CSS px).
  fontSize: number;
  // Geometria logica (CSS px). `null` = ainda nao posicionada; o backend
  // decide um lugar em cascata na primeira abertura.
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export const NOTE_COLORS: NoteColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
];

/** Hex dos nomes legados, para migrar notas salvas em versoes antigas. */
export const LEGACY_COLOR_HEX: Record<NoteColor, string> = {
  yellow: "#ffd84d",
  green: "#c8f7cf",
  blue: "#c7e7ff",
  pink: "#ffd4e4",
  purple: "#e3d5ff",
};

/** Atalhos rapidos de cor exibidos como bolinhas no cabecalho. */
export const NOTE_COLOR_PRESETS: string[] = [
  "#ffd84d",
  "#c8f7cf",
  "#c7e7ff",
  "#ffd4e4",
  "#e3d5ff",
];

export const DEFAULT_NOTE_COLOR = "#ffd84d";
export const DEFAULT_NOTE_GRADIENT = false;
export const DEFAULT_NOTE_OPACITY = 1;
export const MIN_NOTE_OPACITY = 0.4;
export const MAX_NOTE_OPACITY = 1;
export const DEFAULT_NOTE_WIDTH = 380;
export const DEFAULT_NOTE_HEIGHT = 320;
export const MIN_NOTE_WIDTH = 340;
export const MIN_NOTE_HEIGHT = 260;
export const MAX_NOTE_CONTENT = 20000;
export const DEFAULT_NOTE_FONT_SIZE = 14;
export const MIN_NOTE_FONT_SIZE = 11;
export const MAX_NOTE_FONT_SIZE = 32;
export const NOTE_FONT_SIZE_STEP = 2;

/** Mantem o tamanho da fonte dentro dos limites suportados. */
export function clampNoteFontSize(value: unknown): number {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : DEFAULT_NOTE_FONT_SIZE;
  return Math.max(MIN_NOTE_FONT_SIZE, Math.min(MAX_NOTE_FONT_SIZE, Math.round(raw)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function isNoteColor(value: unknown): value is NoteColor {
  return typeof value === "string" && (NOTE_COLORS as string[]).includes(value);
}

/** Valida um hex curto (#rgb) ou longo (#rrggbb). */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

/** Aceita hex livre ou migra nomes legados; cai no padrao se invalido. */
export function normalizeNoteColor(value: unknown): string {
  if (isHexColor(value)) {
    const hex = value.toLowerCase();
    return hex === "#fff" || hex === "#ffffff" || hex === "#ffe98a"
      ? DEFAULT_NOTE_COLOR
      : hex;
  }
  if (isNoteColor(value)) return LEGACY_COLOR_HEX[value];
  return DEFAULT_NOTE_COLOR;
}

/** Mantem a opacidade do fundo entre MIN_NOTE_OPACITY e 1. */
export function clampNoteOpacity(value: unknown): number {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : DEFAULT_NOTE_OPACITY;
  const clamped = Math.max(MIN_NOTE_OPACITY, Math.min(MAX_NOTE_OPACITY, raw));
  return Math.round(clamped * 100) / 100;
}

/** Expande #rgb/#rrggbb para [r,g,b] (0..255). */
export function hexToRgb(hex: string): [number, number, number] {
  const safe = isHexColor(hex) ? hex : DEFAULT_NOTE_COLOR;
  let body = safe.slice(1);
  if (body.length === 3) body = body.split("").map((c) => c + c).join("");
  const num = parseInt(body, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** rgba() a partir de um hex + alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Clareia (amount>0) ou escurece (amount<0) um hex; retorna rgba. */
export function shadeColor(hex: string, amount: number, alpha = 1): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) =>
    amount >= 0
      ? Math.round(c + (255 - c) * amount)
      : Math.round(c * (1 + amount));
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${mix(r)}, ${mix(g)}, ${mix(b)}, ${a})`;
}

/** Estilo visual do fundo da nota: cor solida, com opacidade. */
export interface NoteSurfaceStyle {
  background: string;
  borderColor: string;
}

export function noteSurfaceStyle(
  color: unknown,
  _gradient: unknown,
  opacity: unknown,
): NoteSurfaceStyle {
  const hex = normalizeNoteColor(color);
  const alpha = clampNoteOpacity(opacity);
  return {
    background: hexToRgba(hex, alpha),
    borderColor: shadeColor(hex, -0.18, Math.min(1, alpha + 0.1)),
  };
}

export function sanitizeNoteContent(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, MAX_NOTE_CONTENT);
}

function finiteOr<T extends number | null>(value: unknown, fallback: T): number | T {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampDimension(value: unknown, min: number, fallback: number): number {
  const raw = finiteOr(value, fallback);
  return Math.max(min, Math.round(raw));
}

/** Cria um objeto Note completo a partir de um parcial. Puro e testavel. */
export function makeNote(
  partial: Partial<Note> = {},
  now: number = Date.now(),
  id: string = makeNoteId(),
): Note {
  return {
    id: typeof partial.id === "string" && partial.id ? partial.id : id,
    content: sanitizeNoteContent(partial.content ?? ""),
    color: normalizeNoteColor(partial.color),
    gradient:
      typeof partial.gradient === "boolean"
        ? partial.gradient
        : DEFAULT_NOTE_GRADIENT,
    opacity: clampNoteOpacity(partial.opacity),
    fontSize: clampNoteFontSize(partial.fontSize),
    x: partial.x === null || partial.x === undefined ? null : finiteOr(partial.x, null),
    y: partial.y === null || partial.y === undefined ? null : finiteOr(partial.y, null),
    width: clampDimension(partial.width, MIN_NOTE_WIDTH, DEFAULT_NOTE_WIDTH),
    height: clampDimension(partial.height, MIN_NOTE_HEIGHT, DEFAULT_NOTE_HEIGHT),
    createdAt: finiteOr(partial.createdAt, now),
    updatedAt: finiteOr(partial.updatedAt, now),
  };
}

export function makeNoteId(): string {
  try {
    return `note-${crypto.randomUUID()}`;
  } catch {
    return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Mescla um patch numa nota existente, mantendo invariantes. Puro. */
export function mergeNote(
  note: Note,
  patch: Partial<Note>,
  now: number = Date.now(),
): Note {
  const next = makeNote({ ...note, ...patch, id: note.id, createdAt: note.createdAt }, now);
  next.updatedAt = now;
  return next;
}

export function normalizeNote(value: unknown): Note | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  return makeNote(value as Partial<Note>, Date.now(), value.id);
}

export function normalizeNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Note[] = [];
  for (const entry of value) {
    const note = normalizeNote(entry);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    out.push(note);
  }
  return out;
}

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: false });
let cache: Note[] | null = null;

export async function loadNotes(): Promise<Note[]> {
  if (cache) return cache;
  try {
    await store.init();
    const raw = await store.get<unknown>(NOTES_KEY);
    cache = normalizeNotes(raw);
    return cache;
  } catch (err) {
    console.warn("[notes] loadNotes failed:", err);
  }
  cache = [];
  return cache;
}

async function persist(notes: Note[]): Promise<void> {
  try {
    await store.init();
    await store.set(NOTES_KEY, notes);
    await store.save();
    cache = notes;
  } catch (err) {
    console.warn("[notes] persist failed:", err);
    throw err;
  }
}

export async function saveNotes(notes: Note[]): Promise<Note[]> {
  const normalized = normalizeNotes(notes);
  await persist(normalized);
  return normalized;
}

export async function getNote(id: string): Promise<Note | null> {
  const notes = await loadNotes();
  return notes.find((note) => note.id === id) ?? null;
}

export async function createNote(partial: Partial<Note> = {}): Promise<Note> {
  const notes = await loadNotes();
  const note = makeNote(partial);
  await persist([...notes, note]);
  return note;
}

export async function updateNote(
  id: string,
  patch: Partial<Note>,
): Promise<Note | null> {
  const notes = await loadNotes();
  const index = notes.findIndex((note) => note.id === id);
  if (index === -1) return null;
  const next = mergeNote(notes[index], patch);
  const copy = notes.slice();
  copy[index] = next;
  await persist(copy);
  return next;
}

export async function deleteNote(id: string): Promise<void> {
  const notes = await loadNotes();
  const copy = notes.filter((note) => note.id !== id);
  if (copy.length === notes.length) return;
  await persist(copy);
}

export function clearNotesCache(): void {
  cache = null;
}
