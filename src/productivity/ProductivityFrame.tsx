import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import type { Placement } from "@floating-ui/core";
import { fitCurrentWindowToViewport } from "../lib/adaptive-window-geometry";
import { SNAP_COLLAPSE_MS, SNAP_SLOW_MS, type SnapMotionPhase } from "../lib/snap-window-motion";
import "./Productivity.css";

interface ProductivityFrameProps {
  title: string;
  subtitle: string;
  Icon: LucideIcon;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  windowSize?: {
    width: number;
    height: number;
    minWidth?: number;
    minHeight?: number;
    aspectRatio?: number;
    lockVerticalResize?: boolean;
    placement?: Placement;
    anchor?: "center" | "top-right";
    resizable?: boolean;
    persistKey?: string;
  };
}

interface PersistedProductivityWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

const store = new LazyStore("settings.json", { defaults: {}, autoSave: false });
const PRODUCTIVITY_WINDOW_KEY_PREFIX = "productivity-window:";
const GEOMETRY_DEBOUNCE_MS = 360;

function isPersistedWindow(value: unknown): value is PersistedProductivityWindow {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every(
    (key) => typeof raw[key] === "number" && Number.isFinite(raw[key]),
  );
}

async function loadPersistedWindow(
  key: string,
): Promise<PersistedProductivityWindow | null> {
  try {
    await store.init();
    const value = await store.get<PersistedProductivityWindow>(key);
    return isPersistedWindow(value) ? value : null;
  } catch (err) {
    console.warn("[productivity] load persisted window failed:", err);
    return null;
  }
}

async function savePersistedWindow(
  key: string,
  value: PersistedProductivityWindow,
): Promise<void> {
  try {
    await store.init();
    await store.set(key, value);
    await store.save();
  } catch (err) {
    console.warn("[productivity] save persisted window failed:", err);
  }
}

async function clampPersistedWindow(
  rect: PersistedProductivityWindow,
  minWidth: number,
  minHeight: number,
  margin = 14,
): Promise<PersistedProductivityWindow> {
  try {
    const monitor = await currentMonitor();
    if (!monitor) return rect;
    const scale = monitor.scaleFactor;
    const left = monitor.position.x / scale + margin;
    const top = monitor.position.y / scale + margin;
    const width = Math.max(minWidth, rect.width);
    const height = Math.max(minHeight, rect.height);
    const right = monitor.position.x / scale + monitor.size.width / scale - margin;
    const bottom = monitor.position.y / scale + monitor.size.height / scale - margin;
    return {
      width,
      height,
      x: Math.round(Math.min(Math.max(rect.x, left), Math.max(left, right - width))),
      y: Math.round(Math.min(Math.max(rect.y, top), Math.max(top, bottom - height))),
    };
  } catch {
    return rect;
  }
}

function aspectSizeFromWidth(
  width: number,
  minWidth: number,
  minHeight: number,
  aspectRatio: number,
): Pick<PersistedProductivityWindow, "width" | "height"> {
  const nextWidth = Math.max(minWidth, Math.round(width));
  const nextHeight = Math.max(minHeight, Math.round(nextWidth / aspectRatio));
  return {
    width: Math.max(minWidth, Math.round(nextHeight * aspectRatio)),
    height: nextHeight,
  };
}

function aspectSizeFromHeight(
  height: number,
  minWidth: number,
  minHeight: number,
  aspectRatio: number,
): Pick<PersistedProductivityWindow, "width" | "height"> {
  const nextHeight = Math.max(minHeight, Math.round(height));
  const nextWidth = Math.max(minWidth, Math.round(nextHeight * aspectRatio));
  return {
    width: nextWidth,
    height: Math.max(minHeight, Math.round(nextWidth / aspectRatio)),
  };
}

function normalizeAspectWindow(
  rect: PersistedProductivityWindow,
  minWidth: number,
  minHeight: number,
  aspectRatio?: number,
): PersistedProductivityWindow {
  if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return {
      ...rect,
      width: Math.max(minWidth, rect.width),
      height: Math.max(minHeight, rect.height),
    };
  }

  const ratio = rect.width / Math.max(1, rect.height);
  if (Math.abs(ratio - aspectRatio) < 0.025) {
    return {
      ...rect,
      width: Math.max(minWidth, rect.width),
      height: Math.max(minHeight, rect.height),
    };
  }

  const fromWidth = aspectSizeFromWidth(rect.width, minWidth, minHeight, aspectRatio);
  const fromHeight = aspectSizeFromHeight(rect.height, minWidth, minHeight, aspectRatio);
  const widthDistance =
    Math.abs(fromWidth.width - rect.width) + Math.abs(fromWidth.height - rect.height);
  const heightDistance =
    Math.abs(fromHeight.width - rect.width) + Math.abs(fromHeight.height - rect.height);
  const size = widthDistance <= heightDistance ? fromWidth : fromHeight;
  return { ...rect, ...size };
}

export default function ProductivityFrame({
  title,
  subtitle,
  Icon,
  children,
  actions,
  className = "",
  windowSize,
}: ProductivityFrameProps) {
  const [phase, setPhase] = useState<SnapMotionPhase>("opening");
  const lastAreaRef = useRef<number | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setPhase("idle"), SNAP_SLOW_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    let disposed = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const unlisten: Array<() => void> = [];

    const configure = async () => {
      const win = getCurrentWindow();
      if (!windowSize) {
        await win.setResizable(false).catch(() => {});
        await win.show().catch((err) => {
          console.warn("[productivity] show failed:", err);
        });
        return;
      }

      const minWidth = windowSize.minWidth ?? 1;
      const minHeight = windowSize.minHeight ?? 1;
      const aspectRatio =
        windowSize.aspectRatio && Number.isFinite(windowSize.aspectRatio)
          ? windowSize.aspectRatio
          : undefined;
      const lockVerticalResize = Boolean(windowSize.lockVerticalResize);
      const nextArea = windowSize.width * windowSize.height;
      const previousArea = lastAreaRef.current;
      if (previousArea !== null) {
        if (nextArea > previousArea) setPhase("expanding");
        else if (nextArea < previousArea) setPhase("collapsing");
        else setPhase("switching");
      }
      lastAreaRef.current = nextArea;

      await win.setResizable(Boolean(windowSize.resizable)).catch(() => {});
      await win.setMinSize(new LogicalSize(minWidth, minHeight)).catch(() => {});

      const persistKey = windowSize.resizable
        ? `${PRODUCTIVITY_WINDOW_KEY_PREFIX}${windowSize.persistKey ?? title}`
        : null;
      const saved = persistKey ? await loadPersistedWindow(persistKey) : null;
      let lastLogicalSize = normalizeAspectWindow(
        { x: 0, y: 0, width: windowSize.width, height: windowSize.height },
        minWidth,
        minHeight,
        aspectRatio,
      );

      if (saved) {
        const rect = await clampPersistedWindow(
          normalizeAspectWindow(saved, minWidth, minHeight, aspectRatio),
          minWidth,
          minHeight,
        );
        await win.setSize(new LogicalSize(Math.round(rect.width), Math.round(rect.height)));
        await win.setPosition(new LogicalPosition(Math.round(rect.x), Math.round(rect.y)));
        lastLogicalSize = rect;
        await win.show();
        await win.unminimize();
        await win.setFocus();
      } else {
        const geometry = await fitCurrentWindowToViewport({
          margin: 14,
          placement: windowSize.placement,
          anchor: windowSize.anchor,
          width: lastLogicalSize.width,
          height: lastLogicalSize.height,
          minWidth,
          minHeight,
          preservePosition: previousArea !== null,
        });
        lastLogicalSize = { ...geometry };
      }

      if (persistKey) {
        let correctingAspect = false;
        const enforceAspectRatio = async () => {
          if (!aspectRatio || correctingAspect) return;
          try {
            const scale = await win.scaleFactor();
            const size = (await win.innerSize()).toLogical(scale);
            const width = Math.round(size.width);
            const height = Math.round(size.height);
            const widthDelta = Math.abs(width - lastLogicalSize.width);
            const heightDelta = Math.abs(height - lastLogicalSize.height);
            const verticalOnlyResize = lockVerticalResize && heightDelta > widthDelta;
            const next = verticalOnlyResize
              ? {
                  width: Math.round(lastLogicalSize.width),
                  height: Math.round(lastLogicalSize.height),
                }
              : aspectSizeFromWidth(width, minWidth, minHeight, aspectRatio);
            lastLogicalSize = { ...lastLogicalSize, ...next };
            if (Math.abs(next.width - width) <= 1 && Math.abs(next.height - height) <= 1) {
              return;
            }
            correctingAspect = true;
            await win.setSize(new LogicalSize(next.width, next.height));
            window.setTimeout(() => {
              correctingAspect = false;
            }, 80);
          } catch (err) {
            correctingAspect = false;
            console.warn("[productivity] aspect resize failed:", err);
          }
        };
        const saveGeometry = () => {
          if (saveTimer) window.clearTimeout(saveTimer);
          saveTimer = window.setTimeout(async () => {
            if (disposed) return;
            try {
              const scale = await win.scaleFactor();
              const pos = (await win.outerPosition()).toLogical(scale);
              const size = (await win.innerSize()).toLogical(scale);
              const rect = normalizeAspectWindow(
                {
                  x: Math.round(pos.x),
                  y: Math.round(pos.y),
                  width: Math.max(minWidth, Math.round(size.width)),
                  height: Math.max(minHeight, Math.round(size.height)),
                },
                minWidth,
                minHeight,
                aspectRatio,
              );
              await savePersistedWindow(persistKey, {
                x: Math.round(pos.x),
                y: Math.round(pos.y),
                width: rect.width,
                height: rect.height,
              });
            } catch (err) {
              console.warn("[productivity] persist geometry failed:", err);
            }
          }, GEOMETRY_DEBOUNCE_MS);
        };
        const offMoved = await win.onMoved(saveGeometry);
        const offResized = await win.onResized(() => {
          void enforceAspectRatio().finally(saveGeometry);
        });
        if (disposed) {
          offMoved();
          offResized();
          return;
        }
        unlisten.push(offMoved, offResized);
      }

      window.setTimeout(
        () => {
          if (!disposed) setPhase("idle");
        },
        previousArea !== null && nextArea < previousArea ? SNAP_COLLAPSE_MS : 40,
      );
    };

    configure().catch((err) => {
      console.warn("[productivity] adaptive geometry failed:", err);
      getCurrentWindow().show().catch(() => {});
    });

    return () => {
      disposed = true;
      if (saveTimer) window.clearTimeout(saveTimer);
      unlisten.forEach((off) => off());
    };
  }, [
    title,
    windowSize?.anchor,
    windowSize?.aspectRatio,
    windowSize?.height,
    windowSize?.lockVerticalResize,
    windowSize?.minHeight,
    windowSize?.minWidth,
    windowSize?.persistKey,
    windowSize?.placement,
    windowSize?.resizable,
    windowSize?.width,
  ]);

  const close = async () => {
    setPhase("closing");
    window.setTimeout(() => {
      getCurrentWindow().close().catch((err) => {
        console.warn("[productivity] close failed:", err);
      });
    }, 220);
  };

  return (
    <main className={`productivity-window phase-${phase} ${className}`}>
      <header className="productivity-titlebar">
        <div className="productivity-brand">
          <span className="productivity-brand-icon" aria-hidden>
            <Icon size={18} strokeWidth={2.2} absoluteStrokeWidth />
          </span>
          <span>
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </span>
        </div>
        <div className="productivity-drag-strip" data-tauri-drag-region aria-hidden="true" />
        <div className="productivity-actions">
          {actions}
          <button
            className="productivity-icon-button danger"
            type="button"
            title="Fechar"
            aria-label="Fechar"
            onClick={close}
          >
            <X size={16} strokeWidth={2.4} absoluteStrokeWidth />
          </button>
        </div>
      </header>
      {phase === "opening" ? (
        <div className="productivity-phase-proxy" aria-hidden />
      ) : null}
      {children}
    </main>
  );
}
