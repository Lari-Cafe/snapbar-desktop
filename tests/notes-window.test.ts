import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const main = read("src/main.tsx");
const app = read("src/App.tsx");
const noteWindow = read("src/notes/NoteWindow.tsx");
const noteCss = read("src/notes/NoteWindow.css");
const designSystem = read("src/styles/design-system.css");
const rust = read("src-tauri/src/notes_window.rs");
const lib = read("src-tauri/src/lib.rs");
const capability = read("src-tauri/capabilities/notes.json");

const ruleBody = (source: string, selector: string) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

describe("floating notes feature", () => {
  it("routes the dedicated note window outside settings", () => {
    expect(main).toContain('#/note');
    expect(main).toContain("NoteWindow");
  });

  it("wires the toolbar Notas button to open note windows (no longer a placeholder)", () => {
    expect(app).toContain('id === "notes"');
    expect(app).toContain('invoke("open_note_window"');
    expect(app).toContain("loadNotes");
    expect(app).toContain("createNote");
  });

  it("makes the Notas button a toggle (open or hide all notes)", () => {
    expect(app).toContain('invoke<boolean>("any_note_window_open")');
    expect(app).toContain('invoke("close_all_note_windows")');
  });

  it("lets each note change its font size", () => {
    expect(noteWindow).toContain("handleFontSize");
    expect(noteWindow).toContain("fontSize");
    expect(noteWindow).toContain("NOTE_FONT_SIZE_STEP");
  });

  it("offers a color wheel and opacity control without gradient UI", () => {
    expect(noteWindow).toContain('type="color"');
    expect(noteWindow).toContain("handleOpacity");
    expect(noteWindow).toContain("noteSurfaceStyle");
    expect(noteWindow).toContain("NOTE_COLOR_PRESETS");
    expect(noteWindow).not.toContain("handleGradientToggle");
    expect(noteWindow).not.toContain("Degrade");
  });

  it("refreshes note storage before reopening notes from the toolbar", () => {
    expect(app).toContain("clearNotesCache");
    expect(app).toContain("clearNotesCache();");
    expect(app).toContain("NOTES_CHANGED_EVENT");
    expect(noteWindow).toContain("emit(NOTES_CHANGED_EVENT");
  });

  it("closes orphan note windows instead of showing a missing-note dialog", () => {
    expect(noteWindow).toContain("closeOrphanWindow");
    expect(noteWindow).not.toContain("Esta nota nao existe mais");
    expect(noteWindow).not.toContain("note-missing");
  });

  it("draws the note flush to the window to avoid a square transparent halo", () => {
    expect(noteCss).toContain("inset: 0");
    expect(noteCss).toContain("box-shadow");
    expect(noteCss).toContain("inset,");
    expect(noteCss).not.toContain("width: 100vw");
    expect(noteCss).not.toContain("inset: 10px");
  });

  it("keeps note colors isolated from global appearance theme overrides", () => {
    expect(designSystem).not.toMatch(/\.note,\s*\n/);
    expect(designSystem).not.toContain(".note-textarea,");
  });

  it("uses contrast-safe Liquid Glass chrome while preserving note paper", () => {
    for (const selector of [
      "body.theme-liquid-glass .note-header",
      "body.theme-liquid-glass .note-palette",
      "body.theme-liquid-glass .note-actions",
      "body.theme-liquid-glass .note-action",
      "body.theme-liquid-glass .note-action:hover:not(:disabled)",
      "body.theme-liquid-glass .note-action.active",
      "body.theme-liquid-glass .note-action:focus-visible",
      "body.theme-liquid-glass .note-font-size",
      "body.theme-liquid-glass .note-palette-row",
      "body.theme-liquid-glass .note-palette-value",
      "body.theme-liquid-glass .note-color-wheel",
      'body.theme-liquid-glass .note-palette-row input[type="range"]',
    ]) {
      expect(ruleBody(noteCss, selector)).toContain("var(--snap-feature-");
    }

    expect(noteCss).not.toMatch(/body\.theme-liquid-glass\s+\.note(?:\s|\{|,)/);
    expect(noteCss).not.toContain("body.theme-liquid-glass .note-textarea");
    expect(noteCss).not.toContain("body.theme-liquid-glass .note-textarea::placeholder");
    expect(noteCss).not.toMatch(
      /body\.theme-liquid-glass\s+\.note-color-dot\s*\{/,
    );

    const palette = ruleBody(noteCss, "body.theme-liquid-glass .note-palette");
    const header = ruleBody(noteCss, "body.theme-liquid-glass .note-header");
    const actions = ruleBody(noteCss, "body.theme-liquid-glass .note-actions");
    for (const chrome of [header, palette, actions]) {
      expect(chrome).toContain("background: rgba(13, 16, 22, 0.92) !important");
    }
    expect(palette).toContain("backdrop-filter: none !important");
    expect(palette).toContain("-webkit-backdrop-filter: none !important");
    expect(ruleBody(noteCss, "body.theme-liquid-glass .note-font-size")).toContain(
      "color: var(--snap-feature-text-dim) !important",
    );
    expect(ruleBody(noteCss, "body.theme-liquid-glass .note-palette-row")).toContain(
      "color: var(--snap-feature-text-dim) !important",
    );
    expect(ruleBody(noteCss, "body.theme-liquid-glass .note-palette-value")).toContain(
      "color: var(--snap-feature-text-dim) !important",
    );
    expect(ruleBody(noteCss, "body.theme-liquid-glass .note-color-wheel")).toContain(
      "border-color: var(--snap-feature-border-strong) !important",
    );
    expect(noteCss).toMatch(
      /body\.theme-liquid-glass\s+\.note-color-dot:focus-visible,\s*body\.theme-liquid-glass\s+\.note-color-wheel:focus-visible\s*\{[^}]*outline-color:\s*var\(--snap-feature-text\)\s*!important/,
    );
    expect(noteWindow).toContain("style={{ background: c }}");
    expect(noteWindow).toContain(
      "style={{ background: surface.background, borderColor: surface.borderColor }}",
    );
  });

  it("keeps color swatches round and gives the note enough room for controls", () => {
    expect(noteCss).toContain("flex: 0 0 18px");
    expect(noteCss).toContain("flex-shrink: 0");
    expect(rust).toContain("DEFAULT_NOTE_W: f64 = 380.0");
    expect(rust).toContain("MIN_NOTE_W: f64 = 340.0");
  });

  it("renders an editable sticky note with color, delete and drag", () => {
    expect(noteWindow).toContain("note-textarea");
    expect(noteWindow).toContain("handleColor");
    expect(noteWindow).toContain("deleteNote");
    expect(noteWindow).toContain("createNote");
    expect(noteWindow).toContain("data-tauri-drag-region");
    expect(noteWindow).toContain("onMoved");
    expect(noteWindow).toContain("onResized");
    expect(noteCss).toContain(".note-color-dot");
  });

  it("creates always-on-top, off-taskbar note windows in Rust", () => {
    expect(rust).toContain("pub async fn open_note_window");
    expect(rust).toContain("pub fn close_note_window");
    expect(rust).toContain("pub fn any_note_window_open");
    expect(rust).toContain("pub fn close_all_note_windows");
    expect(rust).toContain("resolve_note_position");
    expect(rust).toContain("available_monitors");
    expect(rust).toContain(".always_on_top(true)");
    expect(rust).toContain(".skip_taskbar(true)");
    expect(rust).toContain(".transparent(true)");
    expect(rust).toContain("#/note?id=");
  });

  it("registers the note window commands in the Tauri handler", () => {
    expect(lib).toContain("mod notes_window;");
    expect(lib).toContain("notes_window::open_note_window");
    expect(lib).toContain("notes_window::close_note_window");
    expect(lib).toContain("notes_window::any_note_window_open");
    expect(lib).toContain("notes_window::close_all_note_windows");
  });

  it("grants a capability scoped to note windows", () => {
    const parsed = JSON.parse(capability) as {
      windows: string[];
      permissions: string[];
    };
    expect(parsed.windows).toContain("note-*");
    expect(parsed.permissions).toContain("store:default");
    expect(parsed.permissions).toContain("core:event:allow-emit");
    expect(parsed.permissions).toContain("core:window:allow-start-dragging");
    expect(parsed.permissions).toContain("core:window:allow-close");
    expect(parsed.permissions).toContain("core:window:allow-outer-position");
    expect(parsed.permissions).toContain("core:window:allow-inner-size");
    expect(parsed.permissions).toContain("core:window:allow-scale-factor");
    expect(parsed.permissions).toContain("core:event:allow-listen");
    expect(parsed.permissions).toContain("core:event:allow-unlisten");
  });
});
