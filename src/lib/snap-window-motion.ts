export type SnapMotionPhase =
  | "opening"
  | "idle"
  | "switching"
  | "expanding"
  | "collapsing"
  | "closing";

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const SNAP_SLOW_MS = 450;
export const SNAP_CARD_STAGGER_MS = 35;
export const SNAP_COLLAPSE_MS = 360;
export const SNAP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const SNAP_MOTION_PHASES: SnapMotionPhase[] = [
  "opening",
  "idle",
  "switching",
  "expanding",
  "collapsing",
  "closing",
];

export function snapSpring(progress: number): number {
  const t = clamp(progress, 0, 1);
  const eased = 1 - Math.pow(1 - t, 3);
  return clamp(eased + Math.sin(t * Math.PI) * 0.012 * (1 - t), 0, 1);
}

export function interpolateWindowRect(
  from: WindowRect,
  to: WindowRect,
  progress: number,
): WindowRect {
  const eased = snapSpring(progress);
  return {
    x: lerp(from.x, to.x, eased),
    y: lerp(from.y, to.y, eased),
    width: lerp(from.width, to.width, eased),
    height: lerp(from.height, to.height, eased),
  };
}

export async function animateWindowGeometry(
  from: WindowRect,
  to: WindowRect,
  applyRect: (rect: WindowRect) => Promise<void> | void,
  duration = SNAP_SLOW_MS,
): Promise<void> {
  if (duration <= 0 || reducedMotion()) {
    await applyRect(to);
    return;
  }

  const start = performance.now();
  await applyRect(from);

  await new Promise<void>((resolve) => {
    const tick = async (now: number) => {
      const progress = clamp((now - start) / duration, 0, 1);
      await applyRect(interpolateWindowRect(from, to, progress));
      if (progress >= 1) {
        await applyRect(to);
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
