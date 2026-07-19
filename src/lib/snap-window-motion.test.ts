import { describe, expect, it } from "vitest";
import {
  SNAP_COLLAPSE_MS,
  SNAP_CARD_STAGGER_MS,
  SNAP_EASE,
  SNAP_MOTION_PHASES,
  SNAP_SLOW_MS,
  interpolateWindowRect,
  snapSpring,
} from "./snap-window-motion";

describe("shared Snapbar window motion", () => {
  it("uses the same smooth motion tokens requested for productivity windows", () => {
    expect(SNAP_SLOW_MS).toBe(450);
    expect(SNAP_COLLAPSE_MS).toBe(360);
    expect(SNAP_CARD_STAGGER_MS).toBe(35);
    expect(SNAP_EASE).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
    expect(SNAP_MOTION_PHASES).toEqual([
      "opening",
      "idle",
      "switching",
      "expanding",
      "collapsing",
      "closing",
    ]);
  });

  it("interpolates geometry with a subtle spring curve", () => {
    const rect = interpolateWindowRect(
      { x: 0, y: 10, width: 100, height: 100 },
      { x: 100, y: 30, width: 300, height: 200 },
      0.5,
    );

    expect(rect.x).toBeGreaterThan(50);
    expect(rect.y).toBeGreaterThan(20);
    expect(rect.width).toBeGreaterThan(200);
    expect(rect.height).toBeGreaterThan(150);
    expect(snapSpring(-1)).toBe(0);
    expect(snapSpring(2)).toBe(1);
  });

});
