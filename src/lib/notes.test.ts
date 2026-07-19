import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTE_COLOR,
  DEFAULT_NOTE_FONT_SIZE,
  DEFAULT_NOTE_GRADIENT,
  DEFAULT_NOTE_HEIGHT,
  DEFAULT_NOTE_OPACITY,
  DEFAULT_NOTE_WIDTH,
  MAX_NOTE_CONTENT,
  MAX_NOTE_FONT_SIZE,
  MIN_NOTE_FONT_SIZE,
  MIN_NOTE_HEIGHT,
  MIN_NOTE_OPACITY,
  MIN_NOTE_WIDTH,
  clampNoteFontSize,
  clampNoteOpacity,
  hexToRgb,
  isHexColor,
  isNoteColor,
  makeNote,
  mergeNote,
  noteSurfaceStyle,
  normalizeNoteColor,
  normalizeNotes,
  sanitizeNoteContent,
  shadeColor,
} from "./notes";

describe("notes store helpers", () => {
  it("creates a note with safe defaults", () => {
    const note = makeNote({}, 1000, "note-fixed");
    expect(note.id).toBe("note-fixed");
    expect(note.content).toBe("");
    expect(note.color).toBe(DEFAULT_NOTE_COLOR);
    expect(note.x).toBeNull();
    expect(note.y).toBeNull();
    expect(DEFAULT_NOTE_WIDTH).toBeGreaterThanOrEqual(360);
    expect(DEFAULT_NOTE_HEIGHT).toBeGreaterThanOrEqual(300);
    expect(MIN_NOTE_WIDTH).toBeGreaterThanOrEqual(320);
    expect(MIN_NOTE_HEIGHT).toBeGreaterThanOrEqual(260);
    expect(note.width).toBe(DEFAULT_NOTE_WIDTH);
    expect(note.height).toBe(DEFAULT_NOTE_HEIGHT);
    expect(note.fontSize).toBe(DEFAULT_NOTE_FONT_SIZE);
    expect(note.gradient).toBe(DEFAULT_NOTE_GRADIENT);
    expect(note.opacity).toBe(DEFAULT_NOTE_OPACITY);
    expect(note.createdAt).toBe(1000);
    expect(note.updatedAt).toBe(1000);
  });

  it("clamps the font size within bounds", () => {
    expect(clampNoteFontSize(18)).toBe(18);
    expect(clampNoteFontSize(1)).toBe(MIN_NOTE_FONT_SIZE);
    expect(clampNoteFontSize(999)).toBe(MAX_NOTE_FONT_SIZE);
    expect(clampNoteFontSize("x" as unknown)).toBe(DEFAULT_NOTE_FONT_SIZE);
    expect(makeNote({ fontSize: 4 }, 0, "note-f").fontSize).toBe(MIN_NOTE_FONT_SIZE);
  });

  it("clamps dimensions to the minimum and keeps valid colors", () => {
    const note = makeNote(
      { width: 10, height: 5, color: "blue", x: 40, y: 60 },
      2000,
      "note-x",
    );
    expect(note.width).toBe(MIN_NOTE_WIDTH);
    expect(note.height).toBe(MIN_NOTE_HEIGHT);
    // Nome legado migra para hex.
    expect(note.color).toBe("#c7e7ff");
    expect(note.x).toBe(40);
    expect(note.y).toBe(60);
  });

  it("accepts free hex colors and migrates legacy names", () => {
    expect(isHexColor("#ABCDEF")).toBe(true);
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("blue")).toBe(false);
    expect(normalizeNoteColor("#11AA33")).toBe("#11aa33");
    expect(normalizeNoteColor("#fff")).toBe(DEFAULT_NOTE_COLOR);
    expect(normalizeNoteColor("#ffffff")).toBe(DEFAULT_NOTE_COLOR);
    expect(normalizeNoteColor("#ffe98a")).toBe(DEFAULT_NOTE_COLOR);
    expect(normalizeNoteColor("green")).toBe("#c8f7cf");
    expect(normalizeNoteColor("nope")).toBe(DEFAULT_NOTE_COLOR);
    expect(makeNote({ color: "#123456" }, 0, "note-h").color).toBe("#123456");
  });

  it("clamps note opacity to the supported range", () => {
    expect(clampNoteOpacity(0.7)).toBe(0.7);
    expect(clampNoteOpacity(0)).toBe(MIN_NOTE_OPACITY);
    expect(clampNoteOpacity(5)).toBe(1);
    expect(clampNoteOpacity("x" as unknown)).toBe(DEFAULT_NOTE_OPACITY);
  });

  it("derives rgb and shaded colors for the surface", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(shadeColor("#000000", 1)).toBe("rgba(255, 255, 255, 1)");
    expect(shadeColor("#ffffff", -1)).toBe("rgba(0, 0, 0, 1)");
  });

  it("builds a solid surface with opacity even when old notes have gradient enabled", () => {
    const grad = noteSurfaceStyle(DEFAULT_NOTE_COLOR, true, 1);
    expect(grad.background).toBe("rgba(255, 216, 77, 1)");
    const solid = noteSurfaceStyle(DEFAULT_NOTE_COLOR, false, 0.5);
    expect(solid.background).toBe("rgba(255, 216, 77, 0.5)");
  });

  it("validates colors", () => {
    expect(isNoteColor("yellow")).toBe(true);
    expect(isNoteColor("green")).toBe(true);
    expect(isNoteColor("orange")).toBe(false);
    expect(isNoteColor(42)).toBe(false);
  });

  it("truncates overly long content", () => {
    const huge = "a".repeat(MAX_NOTE_CONTENT + 500);
    expect(sanitizeNoteContent(huge)).toHaveLength(MAX_NOTE_CONTENT);
    expect(sanitizeNoteContent(123 as unknown)).toBe("");
  });

  it("merges patches while preserving id/createdAt and bumping updatedAt", () => {
    const base = makeNote({ content: "old" }, 1000, "note-keep");
    const merged = mergeNote(
      base,
      { content: "new", color: "#ffd4e4", fontSize: 20, gradient: false, opacity: 0.6 },
      5000,
    );
    expect(merged.id).toBe("note-keep");
    expect(merged.createdAt).toBe(1000);
    expect(merged.updatedAt).toBe(5000);
    expect(merged.content).toBe("new");
    expect(merged.color).toBe("#ffd4e4");
    expect(merged.fontSize).toBe(20);
    expect(merged.gradient).toBe(false);
    expect(merged.opacity).toBe(0.6);
  });

  it("normalizes a list, dropping junk and de-duplicating ids", () => {
    const notes = normalizeNotes([
      { id: "note-a", content: "a" },
      { id: "note-a", content: "dup" },
      { content: "no id" },
      null,
      "garbage",
      { id: "note-b", color: "green" },
    ]);
    expect(notes.map((n) => n.id)).toEqual(["note-a", "note-b"]);
    expect(notes[0].content).toBe("a");
    expect(notes[1].color).toBe("#c8f7cf");
  });

  it("returns an empty list for non-array input", () => {
    expect(normalizeNotes(undefined)).toEqual([]);
    expect(normalizeNotes({})).toEqual([]);
  });
});
