import type { AppearanceSettings } from "./app-settings";
export function applyAppearanceSettings(appearance: AppearanceSettings): void {
  document.body.classList.toggle("theme-default", appearance.preset === "default");
  document.body.classList.toggle("theme-liquid-glass", appearance.preset === "liquidGlass");
  document.body.classList.toggle("snap-reduced-motion", !appearance.motion.enabled);
  document.documentElement.style.setProperty("--snap-accent", appearance.accentColor);
  document.documentElement.style.setProperty("--snap-glass-intensity", appearance.glassIntensity);
  document.documentElement.style.setProperty("--snap-glass-blur", `${appearance.glass.blur}px`);
  document.documentElement.style.setProperty("--snap-glass-saturation", `${appearance.glass.saturation}%`);
  document.documentElement.style.setProperty("--snap-glass-opacity", String(appearance.glass.opacity / 100));
  document.documentElement.style.setProperty("--snap-radius", `${appearance.glass.radius}px`);
  document.documentElement.style.setProperty("--snap-border-strength", String(appearance.glass.border / 100));
  document.documentElement.style.setProperty("--snap-highlight-strength", String(appearance.glass.highlight / 100));
  document.documentElement.style.setProperty("--snap-motion-speed", String(100 / appearance.motion.speed));
  document.documentElement.style.setProperty("--snap-motion-stagger", `${appearance.motion.stagger}ms`);
  document.documentElement.style.setProperty("--snap-motion-morph", String(appearance.motion.morph / 100));
}
