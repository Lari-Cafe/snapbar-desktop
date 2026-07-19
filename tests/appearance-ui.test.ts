import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync("src/main.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const settings = readFileSync("src/settings/sections/SectionJanela.tsx", "utf8");
const rustSettingsWindow = readFileSync("src-tauri/src/settings_window.rs", "utf8");
const rustLib = readFileSync("src-tauri/src/lib.rs", "utf8");
const capability = readFileSync("src-tauri/capabilities/default.json", "utf8");
const designSystem = readFileSync("src/styles/design-system.css", "utf8");

const removedAppearanceFiles = [
  "src/appearance/AppearanceApp.tsx",
  "src/appearance/AppearanceApp.css",
  "src/lib/appearance-runtime.tsx",
  "src/components/ui/glow-card.tsx",
  "src/components/ui/liquid-glass.tsx",
  "src/components/ui/material.tsx",
  "src/components/vendor/21st/one-toggle.tsx",
  "src/components/vendor/21st/origin-button.tsx",
  "src/lib/utils.ts",
];

describe("removed appearance island", () => {
  it("keeps the dormant Appearance route and window out of the runtime", () => {
    expect(main).not.toContain("#/appearance");
    expect(main).not.toContain("AppearanceApp");
    expect(settings).not.toContain("open_appearance_window");
    expect(settings).not.toContain("Abrir Aparencia");
    expect(rustSettingsWindow).not.toContain("open_appearance_window");
    expect(rustSettingsWindow).not.toContain("index.html#/appearance");
    expect(rustLib).not.toContain("settings_window::open_appearance_window");
    expect(capability).not.toContain('"appearance"');
  });

  it("removes the appearance-only component files", () => {
    for (const file of removedAppearanceFiles) {
      expect(existsSync(file), file).toBe(false);
    }
  });

  it("keeps the main toolbar on the real floating implementation", () => {
    expect(app).not.toContain("SnapAdaptiveToolbar");
    expect(app).not.toContain("useAppearanceSettings");
    expect(app).toContain('"toolbar-floating"');
    expect(app).toContain("floating-toolbar-surface");
    expect(app).toContain("floating-toolbar-collapsed");
    expect(app).toContain("<Plus");
    expect(app).toContain("<Minus");
  });

  it("keeps global visual tokens without appearance-window selectors", () => {
    expect(designSystem).toContain("theme-liquid-glass");

    expect(designSystem).not.toContain(".appearance-window");
    expect(designSystem).not.toContain(".appearance-card");
    expect(designSystem).not.toContain(".appearance-preview-panel");
  });
});
