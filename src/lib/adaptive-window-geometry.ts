import {
  computePosition,
  flip,
  offset,
  shift,
  size,
  type Dimensions,
  type Platform,
  type Placement,
  type Rect,
} from "@floating-ui/core";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { animateWindowGeometry } from "./snap-window-motion";

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AdaptiveWindowOptions {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  placement?: Placement;
  margin?: number;
  anchor?: "center" | "top-right";
  show?: boolean;
  preservePosition?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function toClientRect(rect: Rect) {
  return {
    ...rect,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  };
}

function createWindowPlatform(
  referenceRect: Rect,
  floatingSize: Dimensions,
  boundaryRect: Rect,
): Platform {
  const floatingRect: Rect = { x: 0, y: 0, ...floatingSize };
  return {
    async getElementRects() {
      return { reference: referenceRect, floating: floatingRect };
    },
    async getClippingRect() {
      return boundaryRect;
    },
    async getDimensions(element) {
      return element === "floating" ? floatingSize : referenceRect;
    },
    async convertOffsetParentRelativeRectToViewportRelativeRect({ rect }) {
      return rect;
    },
    async getOffsetParent() {
      return null;
    },
    async isElement() {
      return false;
    },
    async getDocumentElement() {
      return null;
    },
    async getClientRects() {
      return [toClientRect(referenceRect)];
    },
    async isRTL() {
      return false;
    },
  };
}

async function monitorBoundary(margin: number): Promise<Rect> {
  const monitor = await currentMonitor();
  if (!monitor) {
    return {
      x: margin,
      y: margin,
      width: Math.max(1, window.innerWidth - margin * 2),
      height: Math.max(1, window.innerHeight - margin * 2),
    };
  }
  const scale = monitor.scaleFactor;
  return {
    x: monitor.position.x / scale + margin,
    y: monitor.position.y / scale + margin,
    width: Math.max(1, monitor.size.width / scale - margin * 2),
    height: Math.max(1, monitor.size.height / scale - margin * 2),
  };
}

function referenceForAnchor(
  boundary: Rect,
  anchor: AdaptiveWindowOptions["anchor"],
): Rect {
  if (anchor === "top-right") {
    return {
      x: boundary.x + boundary.width,
      y: boundary.y,
      width: 1,
      height: 1,
    };
  }
  return {
    x: boundary.x + boundary.width / 2,
    y: boundary.y + boundary.height / 2,
    width: 1,
    height: 1,
  };
}

export async function computeAdaptiveWindowGeometry(
  options: AdaptiveWindowOptions,
): Promise<WindowGeometry> {
  const margin = options.margin ?? 12;
  const boundary = await monitorBoundary(margin);
  const floatingSize = {
    width: clamp(options.width, options.minWidth ?? 1, boundary.width),
    height: clamp(options.height, options.minHeight ?? 1, boundary.height),
  };
  const anchor = options.anchor ?? "center";
  if (anchor === "center") {
    const x = boundary.x + (boundary.width - floatingSize.width) / 2;
    const y = boundary.y + (boundary.height - floatingSize.height) / 2;
    return {
      x: Math.round(clamp(x, boundary.x, boundary.x + boundary.width - floatingSize.width)),
      y: Math.round(clamp(y, boundary.y, boundary.y + boundary.height - floatingSize.height)),
      width: Math.round(floatingSize.width),
      height: Math.round(floatingSize.height),
    };
  }

  const reference = referenceForAnchor(boundary, anchor);

  const result = await computePosition("reference", "floating", {
    placement: options.placement ?? "bottom-end",
    platform: createWindowPlatform(reference, floatingSize, boundary),
    middleware: [
      offset(0),
      flip({
        rootBoundary: boundary,
        padding: 0,
      }),
      shift({
        crossAxis: true,
        rootBoundary: boundary,
        padding: 0,
      }),
      size({
        rootBoundary: boundary,
        padding: 0,
        apply({ availableWidth, availableHeight }) {
          floatingSize.width = clamp(floatingSize.width, options.minWidth ?? 1, availableWidth);
          floatingSize.height = clamp(floatingSize.height, options.minHeight ?? 1, availableHeight);
        },
      }),
    ],
  });

  return {
    x: Math.round(clamp(result.x, boundary.x, boundary.x + boundary.width - floatingSize.width)),
    y: Math.round(clamp(result.y, boundary.y, boundary.y + boundary.height - floatingSize.height)),
    width: Math.round(floatingSize.width),
    height: Math.round(floatingSize.height),
  };
}

export async function fitCurrentWindowToViewport(
  options: AdaptiveWindowOptions,
): Promise<WindowGeometry> {
  let geometry = await computeAdaptiveWindowGeometry(options);
  const win = getCurrentWindow();
  const monitor = await currentMonitor();
  const scale = monitor?.scaleFactor ?? 1;
  let from = geometry;
  try {
    const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
    from = {
      x: position.x / scale,
      y: position.y / scale,
      width: size.width / scale,
      height: size.height / scale,
    };
    if (options.preservePosition) {
      const boundary = await monitorBoundary(options.margin ?? 12);
      geometry = {
        ...geometry,
        x: Math.round(clamp(from.x, boundary.x, boundary.x + boundary.width - geometry.width)),
        y: Math.round(clamp(from.y, boundary.y, boundary.y + boundary.height - geometry.height)),
      };
    }
  } catch {
    from = geometry;
  }
  await animateWindowGeometry(from, geometry, async (rect) => {
    await win.setSize(new LogicalSize(Math.round(rect.width), Math.round(rect.height)));
    await win.setPosition(new LogicalPosition(Math.round(rect.x), Math.round(rect.y)));
  });
  if (options.show !== false) {
    await win.show();
    await win.unminimize();
    await win.setFocus();
  }
  return geometry;
}
