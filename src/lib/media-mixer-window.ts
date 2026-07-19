export type MixerOpenDirection = "up" | "down";

export interface MixerWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MEDIA_MIXER_COMPACT_SIZE = { width: 620, height: 92 } as const;
export const MEDIA_MIXER_EXPANDED_SIZE = {
  width: MEDIA_MIXER_COMPACT_SIZE.width,
  height: 214,
} as const;
export const MEDIA_MIXER_ANIMATION_MS = 450;
export const MEDIA_MIXER_CARD_STAGGER_MS = 35;
export const MEDIA_MIXER_EXPANSION_HEIGHT =
  MEDIA_MIXER_EXPANDED_SIZE.height - MEDIA_MIXER_COMPACT_SIZE.height;

export function compactRectFromWindowRect(
  rect: MixerWindowRect,
  direction: MixerOpenDirection,
  expanded: boolean,
): MixerWindowRect {
  if (!expanded) {
    return compactRectAt(rect.x, rect.y);
  }
  return compactRectAt(
    rect.x,
    direction === "up" ? rect.y + MEDIA_MIXER_EXPANSION_HEIGHT : rect.y,
  );
}

export function compactRectAt(x: number, y: number): MixerWindowRect {
  return {
    x,
    y,
    width: MEDIA_MIXER_COMPACT_SIZE.width,
    height: MEDIA_MIXER_COMPACT_SIZE.height,
  };
}

export function expandedRectAt(
  x: number,
  y: number,
  direction: MixerOpenDirection,
): MixerWindowRect {
  return {
    x,
    y: direction === "up" ? y - MEDIA_MIXER_EXPANSION_HEIGHT : y,
    width: MEDIA_MIXER_EXPANDED_SIZE.width,
    height: MEDIA_MIXER_EXPANDED_SIZE.height,
  };
}

export function clampRectToBoundary(
  rect: MixerWindowRect,
  boundary: MixerWindowRect,
): MixerWindowRect {
  return {
    ...rect,
    x: clamp(rect.x, boundary.x, boundary.x + boundary.width - rect.width),
    y: clamp(rect.y, boundary.y, boundary.y + boundary.height - rect.height),
  };
}

export function collapseTargetFromAnchor(
  anchor: MixerWindowRect,
  boundary?: MixerWindowRect | null,
): MixerWindowRect {
  const compact = compactRectAt(anchor.x, anchor.y);
  return boundary ? clampRectToBoundary(compact, boundary) : compact;
}

export function interpolateRect(
  from: MixerWindowRect,
  to: MixerWindowRect,
  progress: number,
): MixerWindowRect {
  const eased = appleSpring(progress);
  return {
    x: lerp(from.x, to.x, eased),
    y: lerp(from.y, to.y, eased),
    width: lerp(from.width, to.width, eased),
    height: lerp(from.height, to.height, eased),
  };
}

export function appleSpring(progress: number): number {
  const t = clamp(progress, 0, 1);
  const eased = 1 - Math.pow(1 - t, 3);
  return clamp(eased + Math.sin(t * Math.PI) * 0.012 * (1 - t), 0, 1);
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
