import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const app = read("src/downloads/DownloadsApp.tsx");
const css = read("src/downloads/DownloadsApp.css");

const ruleBody = (source: string, selector: string) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

describe("Downloads user interface", () => {
  it("does not expose local hardware diagnostics to regular users", () => {
    expect(app).not.toContain("PC: NVIDIA");
    expect(app).not.toContain("PC: CPU local");
    expect(app).not.toContain("hardwareLabel");
    expect(app).not.toContain("downloads-hardware");
    expect(css).not.toContain("downloads-hardware");
  });

  it("explains download states with accessible feedback", () => {
    expect(app).toContain("Cole um link para analisar antes de baixar.");
    expect(app).toContain("Cole um link público que comece com http ou https.");
    expect(app).toContain("Não consegui analisar este link. Verifique se ele é público.");
    expect(app).toContain('role={probeStatus === "error" ? "alert" : "status"}');
    expect(app).toContain("Cole um link, escolha o formato e acompanhe o progresso aqui.");
    expect(css).toContain(".downloads-feedback.ready");
    expect(css).toContain(".downloads-feedback.loading");
  });

  it("uses Liquid Glass blur tokens only on the Downloads outer shell", () => {
    const liquidGlassWindow = ruleBody(
      css,
      "body.theme-liquid-glass .downloads-window",
    );

    expect(liquidGlassWindow).toContain(
      "backdrop-filter: blur(var(--snap-glass-blur)) saturate(var(--snap-glass-saturation)) !important",
    );
    expect(liquidGlassWindow).toContain(
      "-webkit-backdrop-filter: blur(var(--snap-glass-blur)) saturate(var(--snap-glass-saturation)) !important",
    );
    expect(liquidGlassWindow).not.toContain("blur(42px)");
    expect(liquidGlassWindow).not.toContain("saturate(190%)");
    expect(css).not.toContain("body.theme-liquid-glass .downloads-compose");
    expect(css).not.toContain("body.theme-liquid-glass .downloads-queue");
    expect(css).not.toContain("body.theme-liquid-glass .downloads-job");
  });

  it("inherits the clean feature palette instead of restoring the old dark tokens", () => {
    const downloadsTokens = ruleBody(css, ":root");

    expect(downloadsTokens).toContain("--downloads-text: var(--snap-feature-text)");
    expect(downloadsTokens).toContain("--downloads-dim: var(--snap-feature-text-dim)");
    expect(downloadsTokens).toContain("--downloads-faint: var(--snap-feature-text-faint)");
    expect(downloadsTokens).toContain("--downloads-panel: var(--snap-feature-bg)");
    expect(downloadsTokens).toContain("--downloads-panel-soft: var(--snap-feature-bg-soft)");
    expect(downloadsTokens).toContain("--downloads-edge: var(--snap-feature-border)");
    expect(downloadsTokens).toContain("--downloads-edge-strong: var(--snap-feature-border-strong)");
  });
});
