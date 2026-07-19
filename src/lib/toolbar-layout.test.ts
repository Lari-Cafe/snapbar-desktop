import { describe, expect, it } from "vitest";
import {
  FLOATING_TOOLBAR_COLLAPSED_SIZE,
  FLOATING_TOOLBAR_EXPANDED_WIDTH,
  FLOATING_TOOLBAR_THICKNESS,
  getButtonAngle,
  getDockTargetSize,
  getDonutCenter,
  getFloatingToolbarTargetSize,
  getToolbarVisualTransition,
  getTargetSize,
  getToolbarButtonSizeForActionCount,
  makeToolbarMetrics,
  resolveToolbarFullSize,
} from "./toolbar-layout";

describe("toolbar layout sizing", () => {
  it("keeps the default toolbar at 320px when the size mode is default", () => {
    expect(resolveToolbarFullSize("default", { width: 300, height: 300 })).toBe(320);
  });

  it("uses compact and mini preset sizes exactly", () => {
    expect(resolveToolbarFullSize("compact", { width: 1920, height: 1080 })).toBe(280);
    expect(resolveToolbarFullSize("mini", { width: 1920, height: 1080 })).toBe(260);
  });

  it("keeps auto at 320px on normal screens and steps down on cramped screens", () => {
    expect(resolveToolbarFullSize("auto", { width: 1920, height: 1080 })).toBe(320);
    expect(resolveToolbarFullSize("auto", { width: 340, height: 720 })).toBe(280);
    expect(resolveToolbarFullSize("auto", { width: 300, height: 720 })).toBe(260);
  });

  it("scales target window sizes and donut centers from the effective size", () => {
    const metrics = makeToolbarMetrics(280);

    expect(getTargetSize(true, "none", metrics)).toEqual([280, 280]);
    expect(getTargetSize(true, "right", metrics)).toEqual([158, 280]);
    expect(getTargetSize(false, "right", metrics)).toEqual([37, 74]);
    expect(getDonutCenter(true, "right", metrics)).toEqual([158, 140]);
    expect(getDonutCenter(false, "right", metrics)).toEqual([37, 37]);
  });

  it("keeps eleven donut actions usable in edge mode", () => {
    const metrics = makeToolbarMetrics(320);
    const angles = Array.from({ length: 11 }, (_, index) =>
      getButtonAngle(index, 11, "right", 0),
    );

    expect(getToolbarButtonSizeForActionCount(metrics, 8)).toBe(44);
    expect(getToolbarButtonSizeForActionCount(metrics, 9)).toBe(40);
    expect(getToolbarButtonSizeForActionCount(metrics, 10)).toBe(36);
    expect(getToolbarButtonSizeForActionCount(metrics, 11)).toBe(32);
    expect(angles[0]).toBe(94);
    expect(angles[10]).toBe(266);
    expect(angles.every(Number.isFinite)).toBe(true);
    expect(angles).toEqual([...angles].sort((a, b) => a - b));
    expect(Math.min(...angles.slice(1).map((angle, index) => angle - angles[index]))).toBeGreaterThan(16);
  });

  it("uses a straight bar window for the new dock instead of a square donut canvas", () => {
    expect(getDockTargetSize(true, "dock", 11, { width: 1920, height: 1080 })).toEqual([
      780,
      92,
    ]);
    expect(getDockTargetSize(false, "dock", 11, { width: 1920, height: 1080 })).toEqual([
      92,
      92,
    ]);
    expect(getDockTargetSize(true, "iconBar", 11, { width: 1920, height: 1080 })).toEqual([
      92,
      484,
    ]);
    expect(getDockTargetSize(true, "dock", 11, { width: 1920, height: 1080 })[1]).toBe(92);
  });

  it("caps the adaptive dock window to small screens without returning a donut square", () => {
    expect(getDockTargetSize(true, "dock", 11, { width: 480, height: 360 })).toEqual([
      432,
      92,
    ]);
    expect(getDockTargetSize(true, "iconBar", 11, { width: 480, height: 360 })).toEqual([
      92,
      264,
    ]);
  });

  it("uses the Figma floating toolbar reference sizes by default", () => {
    expect(getFloatingToolbarTargetSize(false, "horizontal", 10)).toEqual([
      FLOATING_TOOLBAR_COLLAPSED_SIZE,
      FLOATING_TOOLBAR_COLLAPSED_SIZE,
    ]);
    expect(getFloatingToolbarTargetSize(true, "horizontal", 10)).toEqual([
      FLOATING_TOOLBAR_EXPANDED_WIDTH,
      FLOATING_TOOLBAR_THICKNESS,
    ]);
    expect(getFloatingToolbarTargetSize(true, "vertical", 10)).toEqual([
      FLOATING_TOOLBAR_THICKNESS,
      FLOATING_TOOLBAR_EXPANDED_WIDTH,
    ]);
  });

  it("clamps floating toolbar targets to small monitor bounds", () => {
    expect(getFloatingToolbarTargetSize(false, "horizontal", 10, { width: 120, height: 120 }, 0)).toEqual([
      72,
      72,
    ]);
    expect(getFloatingToolbarTargetSize(true, "horizontal", 10, { width: 480, height: 360 })).toEqual([
      432,
      86,
    ]);
    expect(getFloatingToolbarTargetSize(true, "vertical", 10, { width: 480, height: 360 })).toEqual([
      86,
      264,
    ]);
  });

  it("keeps the visual resize anchored on every toolbar side", () => {
    const expandedHorizontal = { width: 760, height: 86 };
    const expandedVertical = { width: 86, height: 760 };
    const collapsed = { width: 86, height: 86 };

    expect(getToolbarVisualTransition(expandedHorizontal, collapsed, "horizontal", "start")).toEqual({
      from: expandedHorizontal,
      to: collapsed,
      anchor: "left",
    });
    expect(getToolbarVisualTransition(expandedHorizontal, collapsed, "horizontal", "end")).toEqual({
      from: expandedHorizontal,
      to: collapsed,
      anchor: "right",
    });
    expect(getToolbarVisualTransition(expandedVertical, collapsed, "vertical", "start")).toEqual({
      from: expandedVertical,
      to: collapsed,
      anchor: "top",
    });
    expect(getToolbarVisualTransition(expandedVertical, collapsed, "vertical", "end")).toEqual({
      from: expandedVertical,
      to: collapsed,
      anchor: "bottom",
    });
  });
});
