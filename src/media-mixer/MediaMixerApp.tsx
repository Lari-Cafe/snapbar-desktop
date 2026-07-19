import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  computePosition,
  flip,
  shift,
  type Dimensions,
  type Platform,
  type Rect,
} from "@floating-ui/core";
import { invoke } from "@tauri-apps/api/core";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  AppWindow,

  Mic,
  MicOff,
  Pause,
  Play,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  clampMixerVolume,
  mediaMixerStatusText,
  normalizeMixerSessions,
  volumePercent,
  type AppVolumeSnapshot,
  type MediaMixerSnapshot,
  type MediaTransportAction,
} from "../lib/media-mixer";
import {
  MEDIA_MIXER_ANIMATION_MS,
  MEDIA_MIXER_CARD_STAGGER_MS,
  MEDIA_MIXER_COMPACT_SIZE,
  MEDIA_MIXER_EXPANDED_SIZE,
  MEDIA_MIXER_EXPANSION_HEIGHT,
  collapseTargetFromAnchor,
  compactRectAt,
  compactRectFromWindowRect,
  interpolateRect,
  type MixerOpenDirection,
  type MixerWindowRect,
} from "../lib/media-mixer-window";
import "./MediaMixerApp.css";

const STORE_PATH = "settings.json";
const MIXER_WINDOW_KEY = "mediaMixerWindow";
const SCREEN_MARGIN = 22;
const ADAPT_DEBOUNCE_MS = 130;
const PLACEMENT_SETTLE_MS = 180;
const MOVE_SAVE_DEBOUNCE_MS = 180;
const CLOSE_ANIMATION_MS = 260;
const MIXER_DOCK_EXIT_MS = 360;

const mixerStore = new LazyStore(STORE_PATH, { defaults: {}, autoSave: false });

interface MixerWindowState {
  x: number;
  y: number;
  expanded: boolean;
  openDirection?: MixerOpenDirection;
}

type MixerMotionPhase = "opening" | "idle" | "expanding" | "expanded" | "collapsing" | "closing";

interface FitMixerWindowOptions {
  animate?: boolean;
  compactRect?: MixerWindowRect | null;
  currentExpanded?: boolean;
  preserveCompactAnchor?: boolean;
}

interface FitMixerWindowResult {
  compactRect: MixerWindowRect;
  direction: MixerOpenDirection;
  targetRect: MixerWindowRect;
}

function isMixerWindowState(value: unknown): value is MixerWindowState {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.x === "number" &&
    Number.isFinite(raw.x) &&
    typeof raw.y === "number" &&
    Number.isFinite(raw.y) &&
    typeof raw.expanded === "boolean" &&
    (raw.openDirection === undefined ||
      raw.openDirection === "up" ||
      raw.openDirection === "down")
  );
}

async function saveMixerWindowState(patch: Partial<MixerWindowState>) {
  await mixerStore.init();
  const current = await mixerStore.get<MixerWindowState>(MIXER_WINDOW_KEY);
  const base = isMixerWindowState(current)
    ? current
    : { x: 0, y: 0, expanded: false, openDirection: "down" as MixerOpenDirection };
  await mixerStore.set(MIXER_WINDOW_KEY, { ...base, ...patch });
  await mixerStore.save();
}

function normalizeSnapshot(snapshot: MediaMixerSnapshot): MediaMixerSnapshot {
  return {
    ...snapshot,
    microphone: snapshot.microphone ?? { available: false, muted: false },
    sessions: normalizeMixerSessions(snapshot.sessions ?? []),
  };
}

function nowPlayingTitle(snapshot: MediaMixerSnapshot | null): string {
  const title = snapshot?.nowPlaying?.title?.trim();
  return title || "Sem mídia ativa";
}

function nowPlayingSubtitle(snapshot: MediaMixerSnapshot | null): string {
  const now = snapshot?.nowPlaying;
  if (!now) return "Abra música ou vídeo";
  const parts = [now.artist, now.appName].map((part) => part?.trim()).filter(Boolean);
  return parts.length ? parts.join(" - ") : "Metadados indisponíveis";
}

function sessionTitle(session: AppVolumeSnapshot): string {
  return session.displayName || session.appName || "Áudio";
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function cardMotionStyle(index: number): CSSProperties {
  return {
    "--media-card-index": index,
    "--media-card-stagger": `${MEDIA_MIXER_CARD_STAGGER_MS}ms`,
    "--media-card-delay": `${MEDIA_MIXER_CARD_STAGGER_MS * index}ms`,
    animationDelay: `${MEDIA_MIXER_CARD_STAGGER_MS * index}ms`,
  } as CSSProperties;
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

async function monitorBoundary(scale: number): Promise<Rect | null> {
  const monitor = await currentMonitor();
  if (!monitor) return null;
  const monitorX = monitor.position.x / scale;
  const monitorY = monitor.position.y / scale;
  const monitorWidth = monitor.size.width / scale;
  const monitorHeight = monitor.size.height / scale;
  return {
    x: monitorX + SCREEN_MARGIN,
    y: monitorY + SCREEN_MARGIN,
    width: Math.max(MEDIA_MIXER_COMPACT_SIZE.width, monitorWidth - SCREEN_MARGIN * 2),
    height: Math.max(MEDIA_MIXER_COMPACT_SIZE.height, monitorHeight - SCREEN_MARGIN * 2),
  };
}

async function currentWindowRect(
  win = getCurrentWindow(),
): Promise<MixerWindowRect> {
  const scale = await win.scaleFactor();
  const position = (await win.outerPosition()).toLogical(scale);
  const size = (await win.outerSize()).toLogical(scale);
  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };
}

async function applyWindowGeometry(
  win: ReturnType<typeof getCurrentWindow>,
  rect: MixerWindowRect,
) {
  await Promise.all([
    win.setSize(new LogicalSize(rect.width, rect.height)),
    win.setPosition(new LogicalPosition(rect.x, rect.y)),
  ]);
}

async function animateWindowGeometry(
  win: ReturnType<typeof getCurrentWindow>,
  from: MixerWindowRect,
  to: MixerWindowRect,
  duration = MEDIA_MIXER_ANIMATION_MS,
) {
  await new Promise<void>((resolve) => {
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const rect = interpolateRect(from, to, progress);
      void applyWindowGeometry(win, rect).finally(() => {
        if (progress < 1) {
          window.requestAnimationFrame(step);
          return;
        }
        void applyWindowGeometry(win, to).finally(resolve);
      });
    };
    window.requestAnimationFrame(step);
  });
}

async function fitMixerWindow(
  nextExpanded: boolean,
  currentDirection: MixerOpenDirection,
  options: FitMixerWindowOptions = {},
): Promise<FitMixerWindowResult> {
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const currentRect = await currentWindowRect(win);
  const boundary = await monitorBoundary(scale);
  const compactBase =
    options.compactRect ??
    compactRectFromWindowRect(
      currentRect,
      currentDirection,
      options.currentExpanded ?? !nextExpanded,
    );

  if (!boundary) {
    const targetRect = nextExpanded
      ? {
          x: compactBase.x,
          y:
            currentDirection === "up"
              ? compactBase.y - MEDIA_MIXER_EXPANSION_HEIGHT
              : compactBase.y,
          width: MEDIA_MIXER_EXPANDED_SIZE.width,
          height: MEDIA_MIXER_EXPANDED_SIZE.height,
        }
      : collapseTargetFromAnchor(compactBase);
    if (options.animate) {
      await animateWindowGeometry(win, currentRect, targetRect);
    } else {
      await applyWindowGeometry(win, targetRect);
    }
    await saveMixerWindowState({
      x: nextExpanded ? compactBase.x : targetRect.x,
      y: nextExpanded ? compactBase.y : targetRect.y,
    });
    return {
      compactRect: nextExpanded ? compactBase : targetRect,
      direction: currentDirection,
      targetRect,
    };
  }

  if (!nextExpanded) {
    const targetRect = collapseTargetFromAnchor(
      compactBase,
      options.preserveCompactAnchor ? null : boundary,
    );
    if (options.animate) {
      await animateWindowGeometry(win, currentRect, targetRect);
    } else {
      await applyWindowGeometry(win, targetRect);
    }
    await saveMixerWindowState({ x: targetRect.x, y: targetRect.y });
    return { compactRect: targetRect, direction: "down", targetRect };
  }

  const referenceRect: Rect = {
    x: clamp(
      compactBase.x,
      boundary.x,
      boundary.x + boundary.width - MEDIA_MIXER_COMPACT_SIZE.width,
    ),
    y: clamp(
      compactBase.y,
      boundary.y,
      boundary.y + boundary.height - MEDIA_MIXER_COMPACT_SIZE.height,
    ),
    width: MEDIA_MIXER_COMPACT_SIZE.width,
    height: MEDIA_MIXER_COMPACT_SIZE.height,
  };
  const floatingSize = {
    width: MEDIA_MIXER_EXPANDED_SIZE.width,
    height: MEDIA_MIXER_EXPANSION_HEIGHT,
  };
  const result = await computePosition("reference", "floating", {
    placement: "bottom-end",
    platform: createWindowPlatform(referenceRect, floatingSize, boundary),
    middleware: [
      flip({
        fallbackPlacements: ["top-end"],
        rootBoundary: boundary,
        padding: 0,
      }),
      shift({
        crossAxis: true,
        rootBoundary: boundary,
        padding: 0,
      }),
    ],
  });
  const opensUp = result.placement.startsWith("top");
  const targetRect = {
    x: clamp(
      result.x,
      boundary.x,
      boundary.x + boundary.width - MEDIA_MIXER_EXPANDED_SIZE.width,
    ),
    y: opensUp
      ? clamp(
          result.y,
          boundary.y,
          boundary.y + boundary.height - MEDIA_MIXER_EXPANDED_SIZE.height,
        )
      : clamp(
          result.y - MEDIA_MIXER_COMPACT_SIZE.height,
          boundary.y,
          boundary.y + boundary.height - MEDIA_MIXER_EXPANDED_SIZE.height,
        ),
    width: MEDIA_MIXER_EXPANDED_SIZE.width,
    height: MEDIA_MIXER_EXPANDED_SIZE.height,
  };

  if (options.animate) {
    await animateWindowGeometry(win, currentRect, targetRect);
  } else {
    await applyWindowGeometry(win, targetRect);
  }

  await saveMixerWindowState({ x: compactBase.x, y: compactBase.y });
  return {
    compactRect: compactBase,
    direction: opensUp ? "up" : "down",
    targetRect,
  };
}

export default function MediaMixerApp() {
  const [snapshot, setSnapshot] = useState<MediaMixerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [openDirection, setOpenDirection] = useState<MixerOpenDirection>("down");
  const [motionPhase, setMotionPhase] = useState<MixerMotionPhase>("opening");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const timersRef = useRef<Record<string, number>>({});
  const expandedRef = useRef(expanded);
  const openDirectionRef = useRef(openDirection);
  const compactAnchorRef = useRef<MixerWindowRect | null>(null);
  const adaptingPlacementRef = useRef(false);
  const animatingGeometryRef = useRef(false);
  const adaptTimerRef = useRef<number | null>(null);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    openDirectionRef.current = openDirection;
  }, [openDirection]);

  const applySnapshot = useCallback((next: MediaMixerSnapshot) => {
    setSnapshot(normalizeSnapshot(next));
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<MediaMixerSnapshot>("media_mixer_snapshot");
      applySnapshot(next);
      setFeedback("");
    } catch {
      setSnapshot({
        available: false,
        message: "Controle de mídia indisponível neste Windows.",
        master: { volume: 0, muted: false },
        microphone: { available: false, muted: false },
        nowPlaying: null,
        sessions: [],
      });
      setLoading(false);
    }
  }, [applySnapshot]);

  const schedulePersistWindowState = useCallback(
    (patch: Partial<MixerWindowState>, delay = MOVE_SAVE_DEBOUNCE_MS) => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
      persistTimerRef.current = window.setTimeout(() => {
        persistTimerRef.current = null;
        void saveMixerWindowState(patch);
      }, delay);
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMotionPhase(expandedRef.current ? "expanded" : "idle");
    }, MEDIA_MIXER_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await mixerStore.init();
      const saved = await mixerStore.get<MixerWindowState>(MIXER_WINDOW_KEY);
      if (cancelled || !isMixerWindowState(saved)) return;
      const savedDirection = saved.openDirection ?? "down";
      const savedCompact = compactRectAt(saved.x, saved.y);
      compactAnchorRef.current = savedCompact;
      setExpanded(saved.expanded);
      expandedRef.current = saved.expanded;
      setOpenDirection(savedDirection);
      openDirectionRef.current = savedDirection;
      const layout = await fitMixerWindow(saved.expanded, savedDirection, {
        compactRect: savedCompact,
        currentExpanded: false,
      });
      if (cancelled) return;
      compactAnchorRef.current = layout.compactRect;
      openDirectionRef.current = layout.direction;
      setOpenDirection(layout.direction);
      await saveMixerWindowState({
        expanded: saved.expanded,
        openDirection: layout.direction,
      });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!cancelled) await refresh();
    };
    load();
    const interval = window.setInterval(load, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      Object.values(timersRef.current).forEach((timer) => window.clearTimeout(timer));
      timersRef.current = {};
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [refresh]);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await win.onMoved(async ({ payload }) => {
        if (adaptingPlacementRef.current || animatingGeometryRef.current) return;
        const scale = await win.scaleFactor();
        const logical = payload.toLogical(scale);
        const movedRect = {
          x: logical.x,
          y: logical.y,
          width: expandedRef.current
            ? MEDIA_MIXER_EXPANDED_SIZE.width
            : MEDIA_MIXER_COMPACT_SIZE.width,
          height: expandedRef.current
            ? MEDIA_MIXER_EXPANDED_SIZE.height
            : MEDIA_MIXER_COMPACT_SIZE.height,
        };
        const compactRect = compactRectFromWindowRect(
          movedRect,
          openDirectionRef.current,
          expandedRef.current,
        );
        compactAnchorRef.current = compactRect;
        const windowState = {
          x: compactRect.x,
          y: compactRect.y,
          expanded: expandedRef.current,
          openDirection: openDirectionRef.current,
        };
        if (!expandedRef.current) {
          schedulePersistWindowState(windowState);
          return;
        }
        if (adaptTimerRef.current) {
          window.clearTimeout(adaptTimerRef.current);
        }
        adaptTimerRef.current = window.setTimeout(() => {
          adaptingPlacementRef.current = true;
          animatingGeometryRef.current = true;
          void fitMixerWindow(true, openDirectionRef.current, {
            animate: true,
            compactRect,
            currentExpanded: true,
          })
            .then((layout) => {
              compactAnchorRef.current = layout.compactRect;
              openDirectionRef.current = layout.direction;
              setOpenDirection(layout.direction);
              return saveMixerWindowState({
                x: layout.compactRect.x,
                y: layout.compactRect.y,
                expanded: true,
                openDirection: layout.direction,
              });
            })
            .finally(() => {
              animatingGeometryRef.current = false;
              window.setTimeout(() => {
                adaptingPlacementRef.current = false;
              }, PLACEMENT_SETTLE_MS);
            });
        }, ADAPT_DEBOUNCE_MS);
      });
    })().catch(() => {});
    return () => {
      if (unlisten) unlisten();
      if (adaptTimerRef.current) {
        window.clearTimeout(adaptTimerRef.current);
        adaptTimerRef.current = null;
      }
    };
  }, [schedulePersistWindowState]);

  const statusText = useMemo(() => mediaMixerStatusText(snapshot), [snapshot]);
  const masterPercent = volumePercent(snapshot?.master.volume ?? 0);
  const now = snapshot?.nowPlaying ?? null;
  const hasCover = !!now?.thumbnailDataUrl;
  const isPlaying = now?.playbackStatus === "playing";
  const sessions = snapshot?.sessions ?? [];
  const showVolumeDock = expanded || motionPhase === "collapsing";

  const invokeWithSnapshot = async <T extends Record<string, unknown>>(
    command: string,
    args?: T,
  ) => {
    const next = await invoke<MediaMixerSnapshot>(command, args);
    applySnapshot(next);
  };

  const resizePanel = async (nextExpanded: boolean) => {
    const currentRect = await currentWindowRect();
    const compactRect =
      nextExpanded || !compactAnchorRef.current
        ? compactRectFromWindowRect(currentRect, openDirectionRef.current, expandedRef.current)
        : compactAnchorRef.current;
    compactAnchorRef.current = compactRect;
    animatingGeometryRef.current = true;
    if (nextExpanded) {
      setMotionPhase("expanding");
    } else {
      setMotionPhase("collapsing");
      await new Promise<void>((resolve) => window.setTimeout(resolve, MIXER_DOCK_EXIT_MS));
    }
    try {
      const layout = await fitMixerWindow(nextExpanded, openDirectionRef.current, {
        animate: false,
        compactRect,
        currentExpanded: expandedRef.current,
        preserveCompactAnchor: !nextExpanded,
      });
      compactAnchorRef.current = layout.compactRect;
      openDirectionRef.current = layout.direction;
      setOpenDirection(layout.direction);
      expandedRef.current = nextExpanded;
      setExpanded(nextExpanded);
      setMotionPhase(nextExpanded ? "expanded" : "idle");
      await saveMixerWindowState({
        x: layout.compactRect.x,
        y: layout.compactRect.y,
        expanded: nextExpanded,
        openDirection: layout.direction,
      });
    } catch {
      setFeedback("Não foi possível ajustar o mixer.");
      setMotionPhase(expandedRef.current ? "expanded" : "idle");
    } finally {
      window.setTimeout(() => {
        animatingGeometryRef.current = false;
      }, PLACEMENT_SETTLE_MS);
    }
  };

  const closeMixerWindow = async () => {
    setMotionPhase("closing");
    await new Promise((resolve) => window.setTimeout(resolve, CLOSE_ANIMATION_MS));
    await getCurrentWindow().close();
  };

  const sendTransport = async (action: MediaTransportAction) => {
    setBusyAction(action);
    try {
      await invokeWithSnapshot("media_mixer_transport", { action });
    } catch {
      setFeedback("Este app não aceitou o comando de mídia.");
    } finally {
      setBusyAction(null);
    }
  };

  const setMasterVolume = (value: number) => {
    const volume = clampMixerVolume(value);
    setSnapshot((current) =>
      current ? { ...current, master: { ...current.master, volume } } : current,
    );
    window.clearTimeout(timersRef.current.master);
    timersRef.current.master = window.setTimeout(() => {
      invokeWithSnapshot("media_mixer_set_master_volume", { volume }).catch(() =>
        setFeedback("Não foi possível alterar o volume geral."),
      );
    }, 120);
  };

  const setMasterMuted = async () => {
    const muted = !(snapshot?.master.muted ?? false);
    setSnapshot((current) =>
      current ? { ...current, master: { ...current.master, muted } } : current,
    );
    try {
      await invokeWithSnapshot("media_mixer_set_master_muted", { muted });
    } catch {
      setFeedback("Não foi possível alterar o mute geral.");
    }
  };

  const setMicrophoneMuted = async () => {
    if (!snapshot?.microphone.available) {
      setFeedback("Nenhum microfone ativo encontrado.");
      return;
    }
    const muted = !snapshot.microphone.muted;
    setSnapshot((current) =>
      current
        ? { ...current, microphone: { ...current.microphone, muted } }
        : current,
    );
    try {
      await invokeWithSnapshot("media_mixer_set_microphone_muted", { muted });
    } catch {
      setFeedback("Não foi possível alterar o mute do microfone.");
    }
  };

  const setSessionVolume = (sessionId: string, value: number) => {
    const volume = clampMixerVolume(value);
    setSnapshot((current) =>
      current
        ? {
            ...current,
            sessions: current.sessions.map((session) =>
              session.id === sessionId ? { ...session, volume } : session,
            ),
          }
        : current,
    );
    window.clearTimeout(timersRef.current[sessionId]);
    timersRef.current[sessionId] = window.setTimeout(() => {
      invokeWithSnapshot("media_mixer_set_session_volume", { sessionId, volume }).catch(() =>
        setFeedback("Não foi possível alterar este app."),
      );
    }, 120);
  };

  const setSessionMuted = async (sessionId: string, muted: boolean) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            sessions: current.sessions.map((session) =>
              session.id === sessionId ? { ...session, muted } : session,
            ),
          }
        : current,
    );
    try {
      await invokeWithSnapshot("media_mixer_set_session_muted", { sessionId, muted });
    } catch {
      setFeedback("Não foi possível alterar o mute deste app.");
    }
  };

  return (
    <main
      className={`media-mixer-window phase-${motionPhase}${expanded ? " expanded" : ""}${
        openDirection === "up" ? " opens-up" : ""
      }`}
    >
      <section className="media-compact-strip">
        <div className="media-top-drag-strip" data-tauri-drag-region aria-hidden="true" />
        <div className="media-compact-content">

        <div className="media-cover" aria-label={hasCover ? "Capa da mídia" : "Sem capa"}>
          {hasCover ? <img src={now.thumbnailDataUrl ?? ""} alt="" draggable={false} /> : null}
        </div>

        <div className="media-now-copy">
          <strong title={nowPlayingTitle(snapshot)}>{nowPlayingTitle(snapshot)}</strong>
          <span title={nowPlayingSubtitle(snapshot)}>
            {loading ? "Carregando" : nowPlayingSubtitle(snapshot)}
          </span>
        </div>

        <div className="media-transport" aria-label="Controles de mídia">
          <button
            className="media-icon-button"
            type="button"
            title="Anterior"
            disabled={busyAction === "previous"}
            onClick={() => sendTransport("previous")}
          >
            <SkipBack size={17} strokeWidth={2} absoluteStrokeWidth />
          </button>
          <button
            className="media-play-button"
            type="button"
            title={isPlaying ? "Pausar" : "Reproduzir"}
            disabled={busyAction === "playPause"}
            onClick={() => sendTransport("playPause")}
          >
            {isPlaying ? (
              <Pause size={19} strokeWidth={2} absoluteStrokeWidth />
            ) : (
              <Play size={19} strokeWidth={2} absoluteStrokeWidth />
            )}
          </button>
          <button
            className="media-icon-button"
            type="button"
            title="Próxima"
            disabled={busyAction === "next"}
            onClick={() => sendTransport("next")}
          >
            <SkipForward size={17} strokeWidth={2} absoluteStrokeWidth />
          </button>
        </div>

        <button
          className="media-icon-button"
          type="button"
          title={snapshot?.master.muted ? "Ativar som geral" : "Mutar geral"}
          onClick={setMasterMuted}
        >
          {snapshot?.master.muted ? (
            <VolumeX size={17} strokeWidth={2} absoluteStrokeWidth />
          ) : (
            <Volume2 size={17} strokeWidth={2} absoluteStrokeWidth />
          )}
        </button>

        <button
          className="media-icon-button"
          type="button"
          title={snapshot?.microphone.muted ? "Ativar microfone" : "Mutar microfone"}
          onClick={setMicrophoneMuted}
        >
          {snapshot?.microphone.muted ? (
            <MicOff size={17} strokeWidth={2} absoluteStrokeWidth />
          ) : (
            <Mic size={17} strokeWidth={2} absoluteStrokeWidth />
          )}
        </button>

        <button
          className={`media-icon-button media-expand-toggle${expanded ? " active" : ""}`}
          type="button"
          title={expanded ? "Recolher volumes" : "Expandir volumes"}
          aria-expanded={expanded}
          onClick={() => resizePanel(!expanded)}
        >
          <SlidersHorizontal size={17} strokeWidth={2} absoluteStrokeWidth />
        </button>

        <button
          className="media-icon-button media-close"
          type="button"
          title="Fechar"
          onClick={closeMixerWindow}
        >
          <X size={16} strokeWidth={2} absoluteStrokeWidth />
        </button>
        </div>
      </section>

      {showVolumeDock && (
        <section className="media-volume-dock" aria-label="Volumes ativos">
          <div className="media-volume-card master" style={cardMotionStyle(0)}>
            <div className="media-volume-head">
              <span>
                <Volume2 size={13} strokeWidth={2} absoluteStrokeWidth />
                Geral
              </span>
              <strong>{masterPercent}%</strong>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={masterPercent}
              onChange={(event) => setMasterVolume(Number(event.target.value) / 100)}
              aria-label="Volume geral"
            />
          </div>

          {sessions.length ? (
            sessions.map((session, index) => (
              <div
                className="media-volume-card"
                key={session.id}
                style={cardMotionStyle(index + 1)}
              >
                <div className="media-volume-head">
                  <span title={sessionTitle(session)}>
                    {session.iconDataUrl ? (
                      <img
                        className="media-app-icon"
                        src={session.iconDataUrl}
                        alt=""
                        draggable={false}
                      />
                    ) : (
                      <AppWindow size={13} strokeWidth={2} absoluteStrokeWidth />
                    )}
                    {sessionTitle(session)}
                  </span>
                  <strong>{volumePercent(session.volume)}%</strong>
                </div>
                <div className="media-session-controls">
                  <button
                    className="media-icon-button"
                    type="button"
                    title={session.muted ? "Ativar som do app" : "Mutar app"}
                    onClick={() => setSessionMuted(session.id, !session.muted)}
                  >
                    {session.muted ? (
                      <VolumeX size={15} strokeWidth={2} absoluteStrokeWidth />
                    ) : (
                      <Volume2 size={15} strokeWidth={2} absoluteStrokeWidth />
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volumePercent(session.volume)}
                    onChange={(event) =>
                      setSessionVolume(session.id, Number(event.target.value) / 100)
                    }
                    aria-label={`Volume de ${sessionTitle(session)}`}
                  />
                </div>
              </div>
            ))
          ) : (
            <div className="media-empty-inline" role="status" aria-live="polite">
              <AppWindow size={15} strokeWidth={2} absoluteStrokeWidth />
              <strong>Nenhum áudio ativo</strong>
              <span>{statusText || "Abra música ou vídeo para controlar volumes por app."}</span>
            </div>
          )}
        </section>
      )}

      {feedback && (
        <div className="media-feedback" role="status" aria-live="polite">
          {feedback}
        </div>
      )}
    </main>
  );
}
