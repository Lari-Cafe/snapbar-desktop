import { describe, expect, it } from "vitest";
import {
  MEDIA_MIXER_ANIMATION_MS,
  MEDIA_MIXER_CARD_STAGGER_MS,
  MEDIA_MIXER_COMPACT_SIZE,
  MEDIA_MIXER_EXPANDED_SIZE,
  appleSpring,
  collapseTargetFromAnchor,
  compactRectFromWindowRect,
  expandedRectAt,
  interpolateRect,
} from "./media-mixer-window";

describe("media mixer window geometry", () => {
  it("uses the requested animation and stagger timings", () => {
    expect(MEDIA_MIXER_ANIMATION_MS).toBe(450);
    expect(MEDIA_MIXER_CARD_STAGGER_MS).toBe(35);
  });

  it("keeps the expanded dock aligned with the compact mixer bar", () => {
    expect(MEDIA_MIXER_EXPANDED_SIZE.width).toBe(MEDIA_MIXER_COMPACT_SIZE.width);
  });

  it("collapses back to the original compact anchor even after expanded clamping", () => {
    const originalCompact = {
      x: 6,
      y: 7,
      width: MEDIA_MIXER_COMPACT_SIZE.width,
      height: MEDIA_MIXER_COMPACT_SIZE.height,
    };
    const clampedExpanded = {
      x: 16,
      y: 7,
      width: MEDIA_MIXER_EXPANDED_SIZE.width,
      height: MEDIA_MIXER_EXPANDED_SIZE.height,
    };

    expect(compactRectFromWindowRect(clampedExpanded, "down", true).x).toBe(16);
    expect(collapseTargetFromAnchor(originalCompact)).toEqual(originalCompact);
  });

  it("derives the compact bar position from an expanded upward window", () => {
    const expanded = expandedRectAt(100, 300, "up");
    const compact = compactRectFromWindowRect(expanded, "up", true);

    expect(compact).toEqual({
      x: 100,
      y: 300,
      width: MEDIA_MIXER_COMPACT_SIZE.width,
      height: MEDIA_MIXER_COMPACT_SIZE.height,
    });
  });

  it("interpolates geometry with a monotonic discrete spring", () => {
    const from = { x: 0, y: 0, width: 620, height: 92 };
    const to = { x: 20, y: 30, width: MEDIA_MIXER_EXPANDED_SIZE.width, height: 214 };
    const mid = interpolateRect(from, to, 0.5);

    expect(appleSpring(0)).toBe(0);
    expect(appleSpring(1)).toBe(1);
    expect(mid.x).toBeGreaterThan(from.x);
    expect(mid.x).toBeLessThan(to.x);
    expect(mid.width).toBe(from.width);
  });
});
