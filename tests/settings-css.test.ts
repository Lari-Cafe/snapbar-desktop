import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "src/settings/SettingsApp.css"),
  "utf8",
);
const designSystem = readFileSync(
  resolve(process.cwd(), "src/styles/design-system.css"),
  "utf8",
);

const popupCss = readFileSync(
  resolve(process.cwd(), "src/typo-fire-popup/TypoFirePopup.css"),
  "utf8",
);

const ruleBody = (source: string, selector: string, standalone = false) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ruleBoundary = "(?:^|})(?:\\s|/\\*[\\s\\S]*?\\*/)*";
  const selectorRule = standalone
    ? `${ruleBoundary}${escapedSelector}\\s*\\{([^}]*)\\}`
    : `${ruleBoundary}(?:[^{}]*?,\\s*)?${escapedSelector}\\s*(?:,[^{}]*?)?\\{([^}]*)\\}`;
  return source.match(new RegExp(selectorRule))?.[1] ?? "";
};

describe("settings visual system", () => {
  it("keeps the settings palette neutral instead of blue-heavy", () => {
    expect(css).not.toContain("rgb(120, 180, 255)");
    expect(css).not.toContain("rgba(120, 180, 255");
  });

  it("disables app-wide shadows so floating windows do not render square halos", () => {
    expect(designSystem).toContain("--snap-shadow: none");
    expect(designSystem).toContain("box-shadow: none !important");
    expect(designSystem).toContain("text-shadow: none !important");
    expect(designSystem).toContain("filter: none !important");
  });

  it("uses a fixed sidebar shell for the wider settings window", () => {
    expect(css).toContain(".settings-shell");
    expect(css).toContain(".settings-sidebar");
    expect(css).toContain(".settings-content");
    expect(css).toContain("grid-template-columns: 188px minmax(0, 1fr)");
  });

  it("collapses settings cleanly on narrow devices", () => {
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("@media (min-width: 761px) and (max-width: 820px)");
    expect(css).toContain("grid-template-columns: 1fr");
    expect(css).toContain("flex-direction: row");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain(".settings-row:not(.settings-row-shortcut)");
  });

  it("keeps sidebar navigation compact and rectangular", () => {
    expect(css).toContain(".settings-nav-item");
    expect(css).toContain("border-radius: 6px");
    expect(css).toContain(".settings-nav::before");
    expect(css).toContain("translateY(calc(var(--settings-active-index");
  });

  it("does not embed the live Typo Fire popup inside settings", () => {
    expect(css).not.toContain(".typo-fire-live-preview");
  });

  it("wraps Typo Fire presets into a rectangular shelf instead of side scrolling", () => {
    const presetRule = css.match(/\.typo-fire-preset-bar\s*\{[^}]+\}/)?.[0] ?? "";
    expect(css).toContain(".typo-fire-preset-bar");
    expect(presetRule).toContain("flex-wrap: wrap");
    expect(presetRule).toContain("overflow: visible");
    expect(presetRule).not.toContain("max-height: 142px");
    expect(css).not.toContain(".typo-fire-preset-bar.expanded");
    expect(presetRule).not.toContain("overflow-x: auto");
  });

  it("makes the Typo Fire settings form readable enough for normal users", () => {
    expect(css).toContain(".typo-fire-section .settings-input");
    expect(css).toContain("font-size: 15px");
    expect(css).toContain(".typo-fire-preset-label");
    expect(css).toContain("font-size: 13.5px");
  });

  it("keeps shortcut capture fields on the white feature palette", () => {
    expect(designSystem).toContain(".shortcut-field");
    expect(designSystem).toContain(".shortcut-empty");
    expect(designSystem).toContain("background: var(--snap-feature-bg) !important");
    expect(designSystem).toContain("color: var(--snap-feature-text-dim) !important");
  });

  it("keeps account backup actions compact and readable", () => {
    expect(css).toContain(".account-backup-actions");
    expect(css).toContain("flex-wrap: wrap");
    expect(css).toContain("account-backup-primary");
    expect(css).not.toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
  });

  it("renders backup include switches as clear status pills", () => {
    expect(css).toContain(".settings-switch");
    expect(css).toContain("min-width: 86px");
    expect(css).toContain("background: currentColor");
    expect(css).toContain("prefers-color-scheme: light");
    expect(css).toContain("background: #1f2329");
    expect(css).not.toContain("translateX(14px)");
  });

  it("lets the settings opacity slider use the available row width", () => {
    expect(designSystem).toContain(".settings-slider {");
    expect(designSystem).toContain("flex: 1 1 auto !important");
    expect(designSystem).toContain("width: 100% !important");
  });

  it("keeps controls responsive without click-press slop", () => {
    expect(designSystem).toContain("--snap-motion-fast: 120ms");
    expect(designSystem).toContain(".typo-fire-popup-item:focus-visible");
    expect(designSystem).toContain("button:not(:disabled)");
    expect(designSystem).not.toContain("Uiverse jolly-robin behavior adapted");
    expect(designSystem).not.toContain("filter: blur(0.18px)");
    expect(designSystem).not.toContain("transform: translateY(1px) scale(var(--snap-press-scale))");
  });

  it("adds desktop redesign depth without restoring app-wide halos", () => {
    expect(designSystem).toContain("radial-gradient(circle at 100% 0%");
    expect(designSystem).toContain("box-shadow: 0 1px 2px rgba(31, 35, 41, 0.06)");
    expect(designSystem).toContain("background: #1f2329 !important");
    expect(designSystem).toContain(".settings-switch {");
    expect(designSystem).toContain("color: rgba(31, 35, 41, 0.72) !important");
  });

  it("removes the failed border glow control and scopes Liquid Glass to feature windows", () => {
    expect(designSystem).not.toContain("--snap-glow-color");
    expect(designSystem).not.toContain("body.snap-glow-enabled");
    expect(designSystem).not.toContain("--snap-glow-local-x");
    expect(css).not.toContain(".settings-color-field");
    expect(css).not.toContain(".settings-row-inline-control");
    const liquidGlassTheme = designSystem.match(
      /body\.theme-liquid-glass\s*\{\s*--snap-feature-bg:[\s\S]*?\n\}/,
    )?.[0] ?? "";
    for (const token of [
      "--settings-text: var(--snap-feature-text)",
      "--settings-text-dim: var(--snap-feature-text-dim)",
      "--settings-text-faint: var(--snap-feature-text-faint)",
      "--settings-accent: var(--snap-feature-text)",
    ]) {
      expect(liquidGlassTheme).toContain(token);
    }
    const liquidGlassSettings = ruleBody(
      designSystem,
      "body.theme-liquid-glass .settings-window",
    );
    expect(liquidGlassSettings).toContain("color: var(--snap-feature-text) !important");
    expect(liquidGlassSettings).toContain("background: var(--snap-feature-bg) !important");
    expect(liquidGlassSettings).toContain(
      "backdrop-filter: blur(var(--snap-glass-blur)) saturate(var(--snap-glass-saturation)) !important",
    );

    for (const selector of [
      "body.theme-liquid-glass .settings-shell",
      "body.theme-liquid-glass .settings-header",
      "body.theme-liquid-glass .settings-sidebar",
      "body.theme-liquid-glass .settings-content",
      "body.theme-liquid-glass .settings-card",
      "body.theme-liquid-glass .settings-row",
    ]) {
      const liquidGlassSurface = ruleBody(designSystem, selector);
      expect(liquidGlassSurface).toContain("color: var(--snap-feature-text) !important");
      expect(liquidGlassSurface).toContain("background: var(--snap-feature-bg-soft) !important");
      expect(liquidGlassSurface).toContain("border-color: var(--snap-feature-border) !important");
      expect(liquidGlassSurface).not.toContain("backdrop-filter");
    }

    const liquidGlassSwitch = ruleBody(
      designSystem,
      "body.theme-liquid-glass .settings-switch",
    );
    expect(liquidGlassSwitch).toContain("color: var(--snap-feature-text) !important");

    const standardSwitch = ruleBody(designSystem, ".settings-switch", true);
    expect(standardSwitch).toContain("color: rgba(31, 35, 41, 0.72) !important");

    const standardSettings = ruleBody(designSystem, ".settings-window", true);
    expect(standardSettings).toContain("border-color: rgba(31, 35, 41, 0.14) !important");
    expect(standardSettings).toContain("background: #fbfcfd !important");
  });

  it("scopes Liquid Glass to the Typo Fire main window without changing its popup or Padrão surfaces", () => {
    const liquidGlassWindow = ruleBody(
      designSystem,
      "body.theme-liquid-glass .typo-fire-window",
    );
    expect(liquidGlassWindow).toContain("color: var(--snap-feature-text) !important");
    expect(liquidGlassWindow).toContain("border-color: var(--snap-feature-border) !important");
    expect(liquidGlassWindow).toContain("background: var(--snap-feature-bg) !important");
    expect(liquidGlassWindow).not.toContain("--settings-text:");
    expect(liquidGlassWindow).not.toContain("--settings-accent:");
    expect(liquidGlassWindow).toContain(
      "backdrop-filter: blur(var(--snap-glass-blur)) saturate(var(--snap-glass-saturation)) !important",
    );

    for (const [selector, token] of [
      [".typo-fire-trigger-preview strong", "--settings-text"],
      [".typo-fire-field > span", "--settings-text-dim"],
      [".typo-fire-prefix-label", "--settings-text-dim"],
      [".typo-fire-preset-trigger", "--settings-text-faint"],
      [".typo-fire-advanced-summary", "--settings-text-dim"],
    ]) {
      expect(ruleBody(css, selector, true)).toContain(`color: var(${token})`);
    }

    for (const selector of [
      "body.theme-liquid-glass .typo-fire-window-header",
      "body.theme-liquid-glass .typo-fire-preset-bar",
      "body.theme-liquid-glass .typo-fire-card",
      "body.theme-liquid-glass .typo-fire-yaml:not([open])",
    ]) {
      const liquidGlassSurface = ruleBody(designSystem, selector);
      expect(liquidGlassSurface).toContain("color: var(--snap-feature-text) !important");
      expect(liquidGlassSurface).toContain("background: var(--snap-feature-bg-soft) !important");
      expect(liquidGlassSurface).toContain("border-color: var(--snap-feature-border) !important");
      expect(liquidGlassSurface).not.toContain("backdrop-filter");
    }

    const liquidGlassPopup = ruleBody(
      designSystem,
      "body.theme-liquid-glass .typo-fire-popup",
    );
    for (const [token, value] of [
      ["--snap-feature-bg", "#ffffff"],
      ["--snap-feature-bg-soft", "#f6f7f9"],
      ["--snap-feature-bg-hover", "#eef1f5"],
      ["--snap-feature-bg-active", "#e4e8ee"],
      ["--snap-feature-bg-muted", "#f3f5f8"],
      ["--snap-feature-text", "#1f2329"],
      ["--snap-feature-text-dim", "rgba(31, 35, 41, 0.72)"],
      ["--snap-feature-text-faint", "rgba(31, 35, 41, 0.52)"],
      ["--snap-feature-border", "rgba(31, 35, 41, 0.1)"],
      ["--snap-feature-border-strong", "rgba(31, 35, 41, 0.22)"],
    ]) {
      expect(liquidGlassPopup).toContain(`${token}: ${value}`);
    }
    expect(liquidGlassPopup).not.toContain("background:");
    expect(liquidGlassPopup).not.toContain("backdrop-filter");

    expect(popupCss).toContain("background: rgba(255, 255, 255, 0.96)");
    expect(popupCss).toContain("color: rgba(18, 20, 24, 0.92)");

    const standardHeader = ruleBody(designSystem, ".typo-fire-window-header");
    expect(standardHeader).toContain(
      "background: linear-gradient(180deg, #ffffff 0%, #f7f8fa 100%) !important",
    );
    const standardPresetBar = ruleBody(designSystem, ".typo-fire-preset-bar");
    const standardYaml = ruleBody(designSystem, ".typo-fire-yaml:not([open])");
    for (const standardSurface of [standardPresetBar, standardYaml]) {
      expect(standardSurface).toContain("background: #f0f3f7 !important");
      expect(standardSurface).toContain("border-color: var(--snap-feature-border) !important");
    }
  });
});
