import type { EdgeState } from "./settings";
import type { ToolbarOrientation, ToolbarShape, ToolbarSizeMode } from "./app-settings";

export interface ToolbarMetrics {
  full: number;
  ringRadius: number;
  buttonSize: number;
  coreSize: number;
  collapsedCoreSize: number;
  collapsedSize: number;
  collapsedEdgeThin: number;
  edgeThickness: number;
}

interface AvailableArea {
  width: number;
  height: number;
}

export interface ToolbarHandoffRect {
  width: number;
  height: number;
}

export type ToolbarVisualAnchor = "left" | "right" | "top" | "bottom";

export interface ToolbarVisualTransition {
  from: ToolbarHandoffRect;
  to: ToolbarHandoffRect;
  anchor: ToolbarVisualAnchor;
}

export function getToolbarVisualTransition(
  from: ToolbarHandoffRect,
  to: ToolbarHandoffRect,
  orientation: ToolbarOrientation,
  anchorSide: "start" | "end",
): ToolbarVisualTransition {
  const anchor: ToolbarVisualAnchor =
    orientation === "horizontal"
      ? anchorSide === "start"
        ? "left"
        : "right"
      : anchorSide === "start"
        ? "top"
        : "bottom";

  return { from, to, anchor };
}

const DEFAULT_FULL = 320;
const COMPACT_FULL = 280;
const MINI_FULL = 260;
const TASKBAR_RESERVE = 48;
export const ADAPTIVE_TOOLBAR_EDGE_INSET = 24;
const DOCK_WINDOW_PADDING = 22;
const DOCK_SURFACE_PADDING = 6;
const DOCK_BUTTON_SIZE = 32;
const DOCK_ITEM_GAP = 4;
const DOCK_SECTION_GAP = 6;
const DOCK_FEEDBACK_WIDTH = 0;
const DOCK_COLLAPSED_CONTENT_WIDTH = 48;
const DOCK_COLLAPSED_CONTENT_HEIGHT = 48;
const DOCK_HORIZONTAL_MIN_HEIGHT = 92;
const DOCK_VERTICAL_MIN_WIDTH = 92;
const DOCK_MIN_WIDTH = 780;
const DOCK_MIN_HEIGHT = 320;
export const FLOATING_TOOLBAR_COLLAPSED_SIZE = 86;
export const FLOATING_TOOLBAR_EXPANDED_WIDTH = 760;
export const FLOATING_TOOLBAR_THICKNESS = 86;
export const FLOATING_TOOLBAR_MONITOR_PADDING = 24;

function getFloatingUsableArea(
  available?: AvailableArea | null,
  taskbarReserve = TASKBAR_RESERVE,
): AvailableArea {
  if (!available) {
    return {
      width: FLOATING_TOOLBAR_EXPANDED_WIDTH,
      height: FLOATING_TOOLBAR_EXPANDED_WIDTH,
    };
  }
  return {
    width: Math.max(64, Math.floor(available.width - FLOATING_TOOLBAR_MONITOR_PADDING * 2)),
    height: Math.max(
      64,
      Math.floor(available.height - taskbarReserve - FLOATING_TOOLBAR_MONITOR_PADDING * 2),
    ),
  };
}

export function getFloatingToolbarTargetSize(
  expanded: boolean,
  orientation: ToolbarOrientation,
  _actionCount: number,
  available?: AvailableArea | null,
  taskbarReserve = TASKBAR_RESERVE,
): [number, number] {
  const usable = getFloatingUsableArea(available, taskbarReserve);

  if (!expanded) {
    const size = Math.min(
      FLOATING_TOOLBAR_COLLAPSED_SIZE,
      usable.width,
      usable.height,
    );
    return [size, size];
  }

  if (orientation === "vertical") {
    return [
      Math.min(FLOATING_TOOLBAR_THICKNESS, usable.width),
      Math.min(FLOATING_TOOLBAR_EXPANDED_WIDTH, usable.height),
    ];
  }

  return [
    Math.min(FLOATING_TOOLBAR_EXPANDED_WIDTH, usable.width),
    Math.min(FLOATING_TOOLBAR_THICKNESS, usable.height),
  ];
}

export function resolveToolbarFullSize(
  mode: ToolbarSizeMode,
  available?: AvailableArea | null,
  taskbarReserve = TASKBAR_RESERVE,
): number {
  if (mode === "default") return DEFAULT_FULL;
  if (mode === "compact") return COMPACT_FULL;
  if (mode === "mini") return MINI_FULL;

  if (!available) return DEFAULT_FULL;
  const usableMin = Math.min(
    Math.max(0, available.width),
    Math.max(0, available.height - taskbarReserve),
  );
  if (usableMin < COMPACT_FULL + 32) return MINI_FULL;
  if (usableMin < DEFAULT_FULL + 40) return COMPACT_FULL;
  return DEFAULT_FULL;
}

export function makeToolbarMetrics(full: number): ToolbarMetrics {
  const scale = full / DEFAULT_FULL;
  const collapsedSize = Math.round(84 * scale);
  return {
    full,
    ringRadius: Math.round(108 * scale),
    buttonSize: full <= MINI_FULL ? 40 : 44,
    coreSize: Math.round(56 * scale),
    collapsedCoreSize: Math.round(64 * scale),
    collapsedSize,
    collapsedEdgeThin: Math.round(collapsedSize / 2),
    edgeThickness: Math.round(180 * scale),
  };
}

export function getToolbarButtonSizeForActionCount(
  metrics: ToolbarMetrics,
  actionCount: number,
): number {
  if (actionCount >= 11) return Math.min(metrics.buttonSize, 32);
  if (actionCount >= 10) return Math.min(metrics.buttonSize, 36);
  if (actionCount >= 9) return Math.min(metrics.buttonSize, 40);
  return metrics.buttonSize;
}

export function getButtonAngle(
  index: number,
  count: number,
  edge: EdgeState,
  rotation: number,
): number {
  if (count <= 1) return -90 + rotation;
  if (edge === "right") {
    const start = 94 + rotation;
    const end = 266 + rotation;
    return start + ((end - start) * index) / (count - 1);
  }
  if (edge === "left") {
    const start = -86 + rotation;
    const end = 86 + rotation;
    return start + ((end - start) * index) / (count - 1);
  }
  if (edge === "top") {
    const start = 4 + rotation;
    const end = 176 + rotation;
    return start + ((end - start) * index) / (count - 1);
  }
  if (edge === "bottom") {
    const start = 184 + rotation;
    const end = 356 + rotation;
    return start + ((end - start) * index) / (count - 1);
  }
  return -90 + (index / count) * 360 + rotation;
}

export function getTargetSize(
  expanded: boolean,
  edge: EdgeState,
  metrics: ToolbarMetrics,
): [number, number] {
  if (!expanded) {
    if (edge === "left" || edge === "right") {
      return [metrics.collapsedEdgeThin, metrics.collapsedSize];
    }
    if (edge === "top" || edge === "bottom") {
      return [metrics.collapsedSize, metrics.collapsedEdgeThin];
    }
    return [metrics.collapsedSize, metrics.collapsedSize];
  }
  if (edge === "left" || edge === "right") return [metrics.edgeThickness, metrics.full];
  if (edge === "top" || edge === "bottom") return [metrics.full, metrics.edgeThickness];
  return [metrics.full, metrics.full];
}

export function getDockTargetSize(
  expanded: boolean,
  shape: ToolbarShape,
  actionCount: number,
  available?: AvailableArea | null,
  taskbarReserve = TASKBAR_RESERVE,
  edge: EdgeState = "none",
): [number, number] {
  const safeActionCount = Math.max(1, actionCount);
  const maxWidth = available
    ? Math.max(220, Math.floor(available.width - ADAPTIVE_TOOLBAR_EDGE_INSET * 2))
    : 780;
  const maxHeight = available
    ? Math.max(120, Math.floor(available.height - taskbarReserve - ADAPTIVE_TOOLBAR_EDGE_INSET * 2))
    : 640;

  const vertical = shape === "iconBar" || edge === "left" || edge === "right";
  const itemCount = safeActionCount + 1; // actions + open/close control

  if (!expanded) {
    return [
      Math.min(maxWidth, DOCK_COLLAPSED_CONTENT_WIDTH + DOCK_WINDOW_PADDING * 2),
      Math.min(maxHeight, Math.max(DOCK_HORIZONTAL_MIN_HEIGHT, DOCK_COLLAPSED_CONTENT_HEIGHT + DOCK_WINDOW_PADDING * 2)),
    ];
  }

  if (vertical) {
    const contentHeight =
      itemCount * DOCK_BUTTON_SIZE +
      Math.max(0, itemCount - 1) * DOCK_ITEM_GAP +
      DOCK_SURFACE_PADDING * 2;
    return [
      Math.min(maxWidth, Math.max(DOCK_VERTICAL_MIN_WIDTH, DOCK_BUTTON_SIZE + DOCK_SURFACE_PADDING * 2 + DOCK_WINDOW_PADDING * 2)),
      Math.min(maxHeight, Math.max(DOCK_MIN_HEIGHT, contentHeight + DOCK_WINDOW_PADDING * 2)),
    ];
  }

  const actionWidth =
    shape === "expandableTabs"
      ? safeActionCount * 78 + Math.max(0, safeActionCount - 1) * DOCK_ITEM_GAP
      : safeActionCount * DOCK_BUTTON_SIZE + Math.max(0, safeActionCount - 1) * DOCK_ITEM_GAP;
  const contentWidth =
    DOCK_BUTTON_SIZE +
    DOCK_SECTION_GAP +
    actionWidth +
    DOCK_SECTION_GAP +
    DOCK_FEEDBACK_WIDTH +
    DOCK_SURFACE_PADDING * 2;
  const contentHeight = DOCK_BUTTON_SIZE + DOCK_SURFACE_PADDING * 2;
  return [
    Math.min(maxWidth, Math.max(DOCK_MIN_WIDTH, contentWidth + DOCK_WINDOW_PADDING * 2)),
    Math.min(maxHeight, Math.max(DOCK_HORIZONTAL_MIN_HEIGHT, contentHeight + DOCK_WINDOW_PADDING * 2)),
  ];
}

export function getDonutCenter(
  expanded: boolean,
  edge: EdgeState,
  metrics: ToolbarMetrics,
): [number, number] {
  if (!expanded) {
    if (edge === "right") return [metrics.collapsedEdgeThin, metrics.collapsedSize / 2];
    if (edge === "left") return [0, metrics.collapsedSize / 2];
    if (edge === "bottom") return [metrics.collapsedSize / 2, metrics.collapsedEdgeThin];
    if (edge === "top") return [metrics.collapsedSize / 2, 0];
    return [metrics.collapsedSize / 2, metrics.collapsedSize / 2];
  }
  if (edge === "right") return [metrics.edgeThickness, metrics.full / 2];
  if (edge === "left") return [0, metrics.full / 2];
  if (edge === "bottom") return [metrics.full / 2, metrics.edgeThickness];
  if (edge === "top") return [metrics.full / 2, 0];
  return [metrics.full / 2, metrics.full / 2];
}
