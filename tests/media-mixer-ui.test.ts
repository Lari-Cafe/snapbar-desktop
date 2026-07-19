import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mixerApp = readFileSync(
  resolve(process.cwd(), "src/media-mixer/MediaMixerApp.tsx"),
  "utf8",
);
const mixerCss = readFileSync(
  resolve(process.cwd(), "src/media-mixer/MediaMixerApp.css"),
  "utf8",
);
const designSystem = readFileSync(
  resolve(process.cwd(), "src/styles/design-system.css"),
  "utf8",
);

describe("media mixer UI", () => {
  it("does not render a floating reload control in the compact strip", () => {
    expect(mixerApp).not.toContain("RefreshCw");
    expect(mixerApp).not.toContain("media-refresh");
    expect(mixerCss).not.toContain("media-refresh");
  });

  it("uses the Snapbar mixer icon for the expansion control", () => {
    expect(mixerApp).toContain("SlidersHorizontal");
    expect(mixerApp).toContain("media-expand-toggle");
  });

  it("keeps native window dragging exclusively in the top strip", () => {
    expect(mixerApp).toContain('<section className="media-compact-strip">');
    expect(mixerApp).toContain('<div className="media-top-drag-strip" data-tauri-drag-region aria-hidden="true" />');
    expect(mixerApp.match(/data-tauri-drag-region/g)).toHaveLength(1);
    expect(mixerApp).not.toContain("media-volume-drag-handle");
    expect(mixerApp).not.toContain('className="media-compact-strip" data-tauri-drag-region');
    expect(mixerCss).toContain(".media-top-drag-strip");
    expect(mixerCss).toContain("--media-radius: 12px");
    expect(mixerCss).toContain("border-radius: 12px");
    expect(mixerCss).not.toContain("--media-radius: 999px");
    expect(mixerCss).toContain("height: 14px");
    expect(mixerCss).toContain("z-index: 1");
    expect(mixerCss).toContain("padding: 10px");
    expect(mixerCss).toContain("grid-template-columns: 52px minmax(0, 1fr) auto 32px 32px 32px 32px");
    expect(mixerCss).not.toContain("grid-template-columns: 24px 52px");
    expect(mixerCss).toContain("border-radius: 12px");
    expect(mixerCss).toContain("overflow-x: auto");
    expect(mixerCss).toContain("scrollbar-width: thin");
    expect(mixerCss).toContain("flex: 0 0 172px");
    expect(mixerCss).toContain("flex: 0 0 150px");
    expect(mixerCss).not.toContain(".media-volume-drag-handle");
  });

  it("uses Floating UI placement for up/down expansion near screen edges", () => {
    expect(mixerApp).toContain("@floating-ui/core");
    expect(mixerApp).toContain("computePosition");
    expect(mixerApp).toContain("flip(");
    expect(mixerApp).toContain("opens-up");
    expect(mixerCss).toContain(".media-mixer-window.opens-up");
    expect(mixerCss).toContain("column-reverse");
  });

  it("recalculates Floating UI placement while the expanded mixer is dragged", () => {
    expect(mixerApp).toContain("win.onMoved");
    expect(mixerApp).toContain("adaptTimerRef");
    expect(mixerApp).toContain("ADAPT_DEBOUNCE_MS");
    expect(mixerApp).toContain("compactAnchorRef");
    expect(mixerApp).toContain("animatingGeometryRef");
  });

  it("ignores delayed Windows move events caused by its own resize", () => {
    const resizePanel = mixerApp.slice(
      mixerApp.indexOf("const resizePanel"),
      mixerApp.indexOf("const closeMixerWindow"),
    );

    expect(mixerApp).toContain("PLACEMENT_SETTLE_MS");
    expect(resizePanel).toContain("window.setTimeout(() => {");
    expect(resizePanel).toContain("animatingGeometryRef.current = false;");
  });

  it("debounces window state persistence while dragging", () => {
    expect(mixerApp).toContain("MOVE_SAVE_DEBOUNCE_MS");
    expect(mixerApp).toContain("persistTimerRef");
    expect(mixerApp).toContain("schedulePersistWindowState(windowState)");
  });

  it("fits a restored expanded mixer before showing the saved placement", () => {
    expect(mixerApp).toContain("compactRectAt(saved.x, saved.y)");
    expect(mixerApp).toContain("fitMixerWindow(saved.expanded, savedDirection,");
    expect(mixerApp).toContain("openDirectionRef.current = layout.direction");
    expect(mixerApp).not.toContain("applyWindowGeometry(win, savedCompact)");
    expect(mixerApp).toContain("const SCREEN_MARGIN = 22");
  });

  it("uses Windows media transport fallbacks when apps ignore GSMTC", () => {
    const rust = readFileSync(resolve(process.cwd(), "src-tauri/src/media_mixer.rs"), "utf8");

    expect(rust).toContain("try_gsmtc_transport(action).await.unwrap_or(false)");
    expect(rust).toContain("send_app_command(action)");
    expect(rust).toContain("send_media_key(action)");
    expect(rust).toContain("WM_APPCOMMAND");
    expect(rust).toContain("KEYEVENTF_EXTENDEDKEY");
  });

  it("renders native app icons for volume sessions when available", () => {
    expect(mixerApp).toContain("session.iconDataUrl");
    expect(mixerApp).toContain('className="media-app-icon"');
    expect(mixerCss).toContain(".media-app-icon");
  });

  it("uses slower easing tokens for Apple-style motion", () => {
    expect(mixerCss).toContain("--media-ease: cubic-bezier(0.22, 1, 0.36, 1)");
    expect(mixerCss).toContain("--media-slow: 450ms");
    expect(mixerCss).toContain("media-dock-in var(--media-slow)");
    expect(mixerCss).toContain("media-card-in var(--media-slow)");
  });

  it("animates native window geometry and visible mixer phases", () => {
    expect(mixerApp).toContain("animateWindowGeometry");
    expect(mixerApp).toContain("requestAnimationFrame");
    expect(mixerApp).toContain("MIXER_DOCK_EXIT_MS");
    expect(mixerApp).toContain("animate: false");
    expect(mixerApp).toContain("phase-${motionPhase}");
    expect(mixerCss).toContain(".media-mixer-window.phase-opening");
    expect(mixerCss).toContain(".media-mixer-window.phase-expanding");
    expect(mixerCss).toContain(".media-mixer-window.phase-collapsing");
    expect(mixerCss).toContain(".media-mixer-window.phase-closing");
  });

  it("uses a light stagger for app volume cards", () => {
    expect(mixerApp).toContain("MEDIA_MIXER_CARD_STAGGER_MS");
    expect(mixerApp).toContain("--media-card-delay");
    expect(mixerCss).toContain("--media-card-stagger: 35ms");
    expect(mixerCss).toContain("animation-delay: var(--media-card-delay, 0ms)");
  });

  it("avoids large clipped external shadows in the transparent mixer window", () => {
    expect(mixerCss).not.toContain("0 18px 48px");
    expect(mixerCss).toContain("inset 0 1px 0");
  });

  it("keeps the outer mixer window transparent under appearance themes", () => {
    expect(designSystem).toContain(".media-mixer-window");
    expect(designSystem).not.toMatch(/\.media-mixer-window,\s*[\s\S]*?var\(--snap-bg-strong\) !important/);
    expect(mixerCss).toContain("background: transparent !important");
    expect(mixerCss).toContain("backdrop-filter: none !important");
    expect(mixerCss).toContain("body.theme-liquid-glass .media-compact-strip");
    expect(mixerCss).toContain("body.theme-liquid-glass .media-volume-dock");
    expect(mixerCss).toContain("body.theme-liquid-glass .media-volume-card");
  });

  it("keeps volume sliders visible on the white feature surface", () => {
    expect(designSystem).toContain('.media-volume-card input[type="range"]');
    expect(designSystem).toContain("::-webkit-slider-runnable-track");
    expect(designSystem).toContain("::-webkit-slider-thumb");
    expect(designSystem).toContain("background: #d7d7d7");
    expect(designSystem).toContain("background: var(--snap-feature-text)");
  });

  it("keeps Padrão feedback separate from the Liquid Glass error override", () => {
    const defaultFeedback = mixerCss.match(
      /(?:^|})\s*\.media-feedback\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const liquidGlassFeedback = mixerCss.match(
      /body\.theme-liquid-glass \.media-feedback\s*\{([^}]*)\}/,
    )?.[1] ?? "";

    expect(defaultFeedback).toContain("color: rgba(255, 185, 185, 0.95)");
    expect(defaultFeedback).toContain("background: rgba(255, 110, 110, 0.09)");
    expect(liquidGlassFeedback).toContain("color: rgba(255, 235, 235, 0.98) !important");
    expect(liquidGlassFeedback).toContain("background: rgba(93, 14, 20, 0.9) !important");
    expect(liquidGlassFeedback).toContain("border-color: rgba(255, 140, 140, 0.54) !important");
    expect(liquidGlassFeedback).toContain("backdrop-filter: none !important");
    expect(liquidGlassFeedback).toContain("-webkit-backdrop-filter: none !important");
  });

  it("keeps Liquid Glass blur on outer mixer surfaces only", () => {
    const liquidGlassOuterSurfaces = mixerCss.match(
      /body\.theme-liquid-glass \.media-compact-strip\s*,\s*body\.theme-liquid-glass \.media-volume-dock\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const liquidGlassVolumeCard = mixerCss.match(
      /body\.theme-liquid-glass \.media-volume-card\s*\{([^}]*)\}/,
    )?.[1] ?? "";

    expect(liquidGlassOuterSurfaces).toContain("backdrop-filter: blur(calc(var(--snap-glass-blur, 30px) * 0.72)) saturate(var(--snap-glass-saturation, 165%)) brightness(1.02) !important");
    expect(liquidGlassOuterSurfaces).toContain("-webkit-backdrop-filter: blur(calc(var(--snap-glass-blur, 30px) * 0.72)) saturate(var(--snap-glass-saturation, 165%)) brightness(1.02) !important");
    expect(liquidGlassVolumeCard).not.toContain("backdrop-filter");
    expect(liquidGlassVolumeCard).not.toContain("-webkit-backdrop-filter");
  });

  it("explains the empty mixer state and announces feedback accessibly", () => {
    expect(mixerApp).toContain("Nenhum áudio ativo");
    expect(mixerApp).toContain("Abra música ou vídeo para controlar volumes por app.");
    expect(mixerApp).toContain('className="media-empty-inline" role="status" aria-live="polite"');
    expect(mixerApp).toContain('className="media-feedback" role="status" aria-live="polite"');
    expect(mixerCss).toContain(".media-empty-inline strong");
    expect(mixerCss).toContain("background: rgba(255, 110, 110, 0.09)");
  });
});
