import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const toolbarActions = readFileSync(
  resolve(process.cwd(), "src/lib/toolbar-actions.ts"),
  "utf8",
);
const audioSettings = readFileSync(
  resolve(process.cwd(), "src/settings/sections/SectionGravacao.tsx"),
  "utf8",
);
const settingsApp = readFileSync(
  resolve(process.cwd(), "src/settings/SettingsApp.tsx"),
  "utf8",
);

describe("speech dictation UI wiring", () => {
  it("adds dictation as a first-class toolbar action", () => {
    expect(toolbarActions).toContain('"dictate"');
    expect(app).toContain("runSpeechAction");
    expect(app).toContain("toggle_dictation");
    expect(toolbarActions).toContain("Digitação por voz");
  });

  it("keeps Windows voice typing out of the Audio settings section", () => {
    expect(audioSettings).not.toContain("loadSpeechSettings");
    expect(audioSettings).not.toContain("saveSpeechSettings");
    expect(audioSettings).not.toContain("Idioma do ditado");
    expect(audioSettings).not.toContain("Colar automaticamente");
    expect(audioSettings).not.toContain("Motor local de ditado");
  });

  it("does not expose the removed offline dictation settings page", () => {
    expect(settingsApp).not.toContain('label: "Ditado"');
    expect(settingsApp).not.toContain("SectionDitado");
  });

  it("keeps audio device detection lazy instead of probing on toolbar startup", () => {
    expect(app).not.toContain('invoke<AudioSource[]>("list_recording_audio_sources")');
    expect(audioSettings).toContain('invoke<AudioSource[]>("list_recording_audio_sources")');
  });
});
