import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const main = read("src/main.tsx");
const app = read("src/App.tsx");
const toolbarActions = read("src/lib/toolbar-actions.ts");
const settings = read("src/settings/SettingsApp.tsx");
const rust = read("src-tauri/src/typo_fire.rs");
const lib = read("src-tauri/src/lib.rs");
const capability = read("src-tauri/capabilities/default.json");
const typoFireApp = read("src/typo-fire/TypoFireApp.tsx");
const typoFireSection = read("src/settings/sections/SectionTypoFire.tsx");
const settingsCss = read("src/settings/SettingsApp.css");

describe("Typo Fire app window", () => {
  it("routes Typo Fire as its own tool instead of a settings page", () => {
    expect(main).toContain("#/typo-fire");
    expect(main).toContain("TypoFireApp");
    expect(typoFireApp).toContain("SectionTypoFire");
    expect(settings).not.toContain("SectionTypoFire");
    expect(settings).not.toContain('label: "Typo Fire"');
  });

  it("adds a Snapbar action and Tauri command for Typo Fire", () => {
    expect(toolbarActions).toContain('id: "typoFire"');
    expect(app).toContain("open_typo_fire_window");
    expect(toolbarActions).toContain("Flame");
    expect(toolbarActions).not.toContain("LayoutGrid");

    expect(rust).toContain("pub async fn open_typo_fire_window");
    expect(lib).toContain("typo_fire::open_typo_fire_window");
    expect(JSON.parse(capability).windows).toContain("typo-fire");
  });

  it("returns focus before applying expansions from Typo Fire", () => {
    expect(rust).toContain("restore_last_external_focus");
    expect(rust.indexOf("restore_last_external_focus")).toBeLessThan(
      rust.indexOf("paste_text_after_backspaces"),
    );
  });

  it("keeps Typo Fire advanced import/export controls collapsed", () => {
    const statusIndex = typoFireSection.indexOf("{enabledCount} snippet");
    const advancedIndex = typoFireSection.indexOf("typo-fire-yaml");
    expect(statusIndex).toBeGreaterThan(-1);
    expect(advancedIndex).toBeGreaterThan(statusIndex);
    expect(typoFireSection).toContain("<summary className=\"typo-fire-advanced-summary\">Avançado</summary>");
    expect(typoFireSection).toContain("Regex e YAML");
    expect(settingsCss).toContain(".typo-fire-yaml:not([open])");
  });
});
