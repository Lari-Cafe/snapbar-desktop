import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCurrentWindow,
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  Plus,
  Minus,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { onAction, type Options as NotificationOptions } from "@tauri-apps/plugin-notification";
import type { PluginListener } from "@tauri-apps/api/core";
import {
  loadSettings,
  saveWindowState,
  flushSettings,
  computeDefaults,
  clampToMonitor,
  type EdgeState,
} from "./lib/settings";
import {
  getFloatingToolbarTargetSize,
} from "./lib/toolbar-layout";
import {
  loadBehavior,
  loadOutputPaths,
  loadShortcuts,
  loadTypoFireMatches,
  loadTypoFireSettings,
  saveTypoFireSettings,
  type BehaviorSettings,
  type OutputPathSettings,
  type ShortcutAction,
  type TypoFireMatch,
  type TypoFireSettings,
  DEFAULT_BEHAVIOR,
  clearAppSettingsCache,
} from "./lib/app-settings";
import type { WindowRect } from "./lib/snap-window-motion";
import {
  runMediaAction,
  shouldIgnoreMediaAction,
  type MediaActionId,
  type MediaActionState,
} from "./lib/media-actions";
import {
  runSpeechAction,
  type SpeechActionState,
} from "./lib/speech-actions";
import {
  loadRecordingPrefs,
  type RecordingPrefs,
} from "./lib/recording-prefs";
import { userFacingError } from "./lib/user-facing-errors";
import type { RuntimeReadiness } from "./lib/runtime-readiness";
import {
  loadNotes,
  createNote,
  clearNotesCache,
  NOTES_CHANGED_EVENT,
  type Note,
} from "./lib/notes";
import {
  playProductivityTone,
  startProductivityAlarm,
  stopPomodoroAlarm,
  stopProductivityAlarm,
} from "./productivity/productivity-alert-sound";
import { buildToolbarActions, type ActionId, type ToolbarAction } from "./lib/toolbar-actions";
import {
  SnapLiquidButtonSurface,
  SnapLiquidSurface,
} from "./components/surfaces/SnapLiquidSurface";
import "./App.css";

type TypoFireEngineStatus = {
  enabled: boolean;
  hookActive: boolean;
};

const DRAG_THRESHOLD = 5;
const TASKBAR_RESERVE = 48;
const FLOATING_TOOLBAR_ACTION_COUNT = 11;

// Limite de rotação em modo edge (arco 180° vs icônes ocupam ~160°)
const ROTATION_MAX_EDGE = 10;

type ToolbarAnchorSide = "start" | "end";
type ToolbarHandoffPhase = "idle" | "collapsing" | "expanding";

const TOOLBAR_GEOMETRY_MS = 405;

interface ToolbarScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function safeToolbarPosition(
  currentX: number,
  currentY: number,
  width: number,
  height: number,
  edge: EdgeState,
  screen: ToolbarScreenBounds,
  taskbarReserve: number,
  edgeInset: number,
): { x: number; y: number } {
  const left = screen.x + edgeInset;
  const top = screen.y + edgeInset;
  const right = screen.x + screen.width - edgeInset;
  const bottom = screen.y + screen.height - taskbarReserve - edgeInset;
  const maxX = Math.max(left, right - width);
  const maxY = Math.max(top, bottom - height);

  let x = currentX;
  let y = currentY;
  if (edge === "left") x = left;
  else if (edge === "right") x = maxX;

  if (edge === "top") y = top;
  else if (edge === "bottom") y = maxY;

  return {
    x: Math.max(left, Math.min(maxX, x)),
    y: Math.max(top, Math.min(maxY, y)),
  };
}

function applyRecordingPrefsToMediaState(
  state: MediaActionState,
  prefs: RecordingPrefs,
): MediaActionState {
  return {
    ...state,
    includeMicrophone: prefs.includeMicrophone ?? state.includeMicrophone,
    includeSystemAudio: prefs.includeSystemAudio ?? state.includeSystemAudio,
    selectedMicrophone: prefs.selectedMicrophone ?? state.selectedMicrophone,
  };
}

function applyOutputPathsToMediaState(
  state: MediaActionState,
  paths: OutputPathSettings,
): MediaActionState {
  return {
    ...state,
    screenshotOutputDir: paths.screenshotDir,
    recordingOutputDir: paths.recordingDir,
  };
}

function recordingPendingFeedback(isRecording: boolean): string {
  return isRecording ? "Finalizando gravação..." : "Preparando gravação...";
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Abre (ou foca) a janela flutuante de uma nota especifica.
async function openNoteWindow(note: Note): Promise<void> {
  await invoke("open_note_window", {
    noteId: note.id,
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
  });
}

async function configureTypoFireEngine(
  settings: TypoFireSettings,
  matches: TypoFireMatch[],
): Promise<TypoFireEngineStatus> {
  const status = await invoke<TypoFireEngineStatus>("typo_fire_configure", {
    settings,
    matches,
  });
  if (settings.enabled && !status.hookActive) {
    return invoke<TypoFireEngineStatus>("typo_fire_reload");
  }
  return status;
}

function ToolbarApp() {
  const [expanded, setExpanded] = useState(true);
  const [edge, setEdge] = useState<EdgeState>("none");
  const [rotation, setRotation] = useState(0);
  const [droppedFiles, setDroppedFiles] = useState<string[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [handoffPhase, setHandoffPhase] = useState<ToolbarHandoffPhase>("idle");
  const [surfaceExpanded, setSurfaceExpanded] = useState(true);
  const [anchorSide, setAnchorSide] = useState<ToolbarAnchorSide>("start");
  const [mediaState, setMediaState] = useState<MediaActionState>({
    isRecording: false,
    audioSources: [],
    includeMicrophone: true,
    includeSystemAudio: true,
  });
  const [speechState, setSpeechState] = useState<SpeechActionState>({
    isDictating: false,
    isTranscribing: false,
  });
  const [actionFeedback, setActionFeedback] = useState("");
  const [runtimeReadiness, setRuntimeReadiness] = useState<RuntimeReadiness | null>(null);
  const [behavior, setBehavior] = useState<BehaviorSettings>(DEFAULT_BEHAVIOR);
  const behaviorRef = useRef(behavior);
  const getVisualTargetSize = useCallback(
    (
      isExpanded: boolean,
      orientation = behaviorRef.current.toolbarOrientation,
      available?: { width: number; height: number } | null,
    ): [number, number] => {
      return getFloatingToolbarTargetSize(
        isExpanded,
        orientation,
        FLOATING_TOOLBAR_ACTION_COUNT,
        available,
        TASKBAR_RESERVE,
      );
    },
    [],
  );
  const [stageHover, setStageHover] = useState(true);
  const [mediaActionPending, setMediaActionPending] = useState(false);

  // Guard pra evitar applyState concorrentes (clicks rápidos)
  const applyingRef = useRef(false);
  const mediaActionPendingRef = useRef(false);
  const anchorSideRef = useRef<ToolbarAnchorSide>("start");
  useEffect(() => {
    anchorSideRef.current = anchorSide;
  }, [anchorSide]);
  const mediaStateRef = useRef(mediaState);
  useEffect(() => {
    mediaStateRef.current = mediaState;
  }, [mediaState]);
  const speechStateRef = useRef(speechState);
  useEffect(() => {
    speechStateRef.current = speechState;
  }, [speechState]);

  // Boot: enquanto hidrata do store, esconde conteúdo via classe .transitioning
  // (opacity:0 + scale + blur). Revela com liquid fade-in quando hidratar termina.
  const [booting, setBooting] = useState(true);
  // bootedRef: depois de hidratar, libera o effect de save automatico
  const bootedRef = useRef(false);

  // Refs pra interpolação smooth da rotação
  const rotationRef = useRef(0);
  const rotationTargetRef = useRef(0);
  const rotationRafRef = useRef<number | null>(null);
  const rotationLastTimeRef = useRef<number>(0);

  // Scroll do mouse gira os ícones com smoothing exponencial frame-rate independent.
  // Time constant TAU=140ms: chega a ~95% do target em ~420ms. Sensação tipo trackpad.
  // Em modo edge: limite proporcional ao arco. Em modo normal: rotação infinita.
  useEffect(() => {
    const TAU_MS = 140;

    const tick = (now: number) => {
      const last = rotationLastTimeRef.current || now;
      const dt = Math.min(now - last, 64); // clamp se aba ficar background
      rotationLastTimeRef.current = now;

      const current = rotationRef.current;
      const target = rotationTargetRef.current;
      const diff = target - current;

      if (Math.abs(diff) < 0.02) {
        rotationRef.current = target;
        setRotation(target);
        rotationRafRef.current = null;
        return;
      }

      // Exp decay: fração suavizada por dt real (consistente em qualquer FPS)
      const smoothing = 1 - Math.exp(-dt / TAU_MS);
      const next = current + diff * smoothing;
      rotationRef.current = next;
      setRotation(next);
      rotationRafRef.current = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * 0.15;
      let next = rotationTargetRef.current + delta;
      if (stateRef.current.edge !== "none") {
        next = Math.max(-ROTATION_MAX_EDGE, Math.min(ROTATION_MAX_EDGE, next));
      }
      rotationTargetRef.current = next;

      if (rotationRafRef.current === null) {
        rotationLastTimeRef.current = performance.now();
        rotationRafRef.current = requestAnimationFrame(tick);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (rotationRafRef.current !== null) {
        cancelAnimationFrame(rotationRafRef.current);
        rotationRafRef.current = null;
      }
    };
  }, []);

  // Hidrata estado da janela a partir do store (ou defaults na first-run).
  // Reusado pelo mount inicial E pelo listener de restore-from-tray.
  // IMPORTANTE: setSize/setPosition acontecem ANTES do setState React, e o
  // bootedRef é pausado durante a hidratação pra não re-disparar saves.
  const hydrateFromStore = useCallback(async () => {
    bootedRef.current = false;
    try {
      const win = getCurrentWindow();
      const loadedBehavior = await loadBehavior();
      let availableArea: { width: number; height: number } | null = null;
      try {
        const monitor = await currentMonitor();
        if (monitor) {
          const scale = monitor.scaleFactor;
          availableArea = {
            width: monitor.size.width / scale,
            height: monitor.size.height / scale,
          };
        }
      } catch {}
      setBehavior(loadedBehavior);

      let state = await loadSettings();
      if (!state) {
        const [defaultW, defaultH] = getFloatingToolbarTargetSize(
          true,
          loadedBehavior.toolbarOrientation,
          FLOATING_TOOLBAR_ACTION_COUNT,
          availableArea,
          TASKBAR_RESERVE,
        );
        state = await computeDefaults(
          defaultW,
          defaultH,
          TASKBAR_RESERVE,
        );
      }
      state = { ...state, edge: "none" };

      const [w, h] = getFloatingToolbarTargetSize(
        state.expanded,
        loadedBehavior.toolbarOrientation,
        FLOATING_TOOLBAR_ACTION_COUNT,
        availableArea,
        TASKBAR_RESERVE,
      );
      state = await clampToMonitor(state, w, h, TASKBAR_RESERVE);

      ignoreMovesUntilRef.current = Date.now() + 800;

      // 1. Aplica geometria à janela
      try {
        await win.setSize(new LogicalSize(w, h));
      } catch (err) {
        console.warn("[hydrate] setSize falhou:", err);
      }
      try {
        await win.setPosition(
          new LogicalPosition(Math.round(state.x), Math.round(state.y))
        );
      } catch (err) {
        console.warn("[hydrate] setPosition falhou:", err);
      }
      try {
        await win.setAlwaysOnTop(loadedBehavior.alwaysOnTop);
      } catch {}

      // 2. Aguarda WebView2 propagar o resize antes de aplicar layout React.
      //    Sem isso, a WebView ainda pode estar com a geometria anterior quando
      //    o React renderiza a barra flutuante.
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
      );

      // 3. Aplica state React (conteúdo agora alinhado com tamanho da janela)
      setExpanded(state.expanded);
      setEdge(state.edge);
      setRotation(state.rotation);
      rotationRef.current = state.rotation;
      rotationTargetRef.current = state.rotation;

      // 4. Aguarda 1 RAF pra React commitar o render antes de devolver controle
      await new Promise<void>((r) => requestAnimationFrame(() => r()));

    } catch (err) {
      console.error("[hydrate] erro:", err);
    } finally {
      bootedRef.current = true;
    }
  }, [
    getVisualTargetSize,
  ]);

  // Listener pro evento de restore (Rust emite quando o tray traz a janela de volta)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.listen("toolbar://restored", async () => {
        await hydrateFromStore();
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [hydrateFromStore]);

  // Listener pro before-quit: Rust avisa antes de app.exit(0).
  // Flushamos settings sincronamente pra garantir que o debounce de 250ms
  // não perde mudanças no quit pelo tray.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.listen("app://before-quit", async () => {
        await flushSettings();
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Carrega prefs de gravacao persistidas. Fontes de audio ficam em lazy probe
  // para nao abrir processo nativo no startup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const prefs = await loadRecordingPrefs();
      if (cancelled) return;
      setMediaState((prev) => applyRecordingPrefsToMediaState(prev, prefs));
      try {
        const readiness = await invoke<RuntimeReadiness>("runtime_readiness");
        if (!cancelled) setRuntimeReadiness(readiness);
      } catch (err) {
        console.warn("[toolbar] runtime readiness failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlistenNotes: (() => void) | null = null;
    let unlistenTypoFire: (() => void) | null = null;
    let unlistenTodoDue: (() => void) | null = null;
    let unlistenPomodoroDone: (() => void) | null = null;
    let unlistenStopPomodoroAlarm: (() => void) | null = null;
    let unlistenNotificationAction: PluginListener | null = null;
    (async () => {
      unlistenNotes = await listen(NOTES_CHANGED_EVENT, () => {
        clearNotesCache();
      });
      unlistenTypoFire = await listen<{ message?: string }>(
        "typo-fire://feedback",
        (event) => {
          const message = event.payload?.message?.trim();
          if (message) setActionFeedback(message);
        },
      );
      unlistenTodoDue = await listen<{ title?: string }>(
        "productivity://todo-due",
        (event) => {
          playProductivityTone("todo");
          const title = event.payload?.title?.trim() || "Tarefa vencida";
          setActionFeedback(`Tarefa: ${title}`);
        },
      );
      unlistenPomodoroDone = await listen(
        "pomodoro://round-complete",
        () => {
          startProductivityAlarm("pomodoro");
          setActionFeedback("Pomodoro finalizado");
        },
      );
      unlistenStopPomodoroAlarm = await listen(
        "productivity://stop-pomodoro-alarm",
        () => stopPomodoroAlarm(),
      );
      unlistenNotificationAction = await onAction(
        (notification: NotificationOptions) => {
          if (notification.title !== "Pomodoro") return;
          stopPomodoroAlarm();
        },
      );
    })();
    return () => {
      if (unlistenNotes) unlistenNotes();
      if (unlistenTypoFire) unlistenTypoFire();
      if (unlistenTodoDue) unlistenTodoDue();
      if (unlistenPomodoroDone) unlistenPomodoroDone();
      if (unlistenStopPomodoroAlarm) unlistenStopPomodoroAlarm();
      if (unlistenNotificationAction) void unlistenNotificationAction.unregister();
      stopProductivityAlarm();
    };
  }, []);

  useEffect(() => {
    let unlistenFocus: (() => void) | null = null;
    const stopOnFocus = () => stopPomodoroAlarm();
    const stopOnVisible = () => {
      if (!document.hidden) stopPomodoroAlarm();
    };

    window.addEventListener("focus", stopOnFocus);
    document.addEventListener("visibilitychange", stopOnVisible);
    (async () => {
      try {
        const win = getCurrentWindow();
        unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
          if (focused) stopPomodoroAlarm();
        });
      } catch {
        // Browser dev preview does not expose Tauri window APIs.
      }
    })();

    return () => {
      window.removeEventListener("focus", stopOnFocus);
      document.removeEventListener("visibilitychange", stopOnVisible);
      if (unlistenFocus) unlistenFocus();
    };
  }, []);

  useEffect(() => {
    if (!actionFeedback) return;
    const timeout = window.setTimeout(
      () => setActionFeedback(""),
      mediaActionPending
        ? 12000
        : mediaState.isRecording
        ? 5200
        : 2400,
    );
    return () => window.clearTimeout(timeout);
  }, [
    actionFeedback,
    mediaActionPending,
    mediaState.isRecording,
  ]);

  // Carrega behavior + reage a mudanças vindas da janela de configurações.
  useEffect(() => {
    let cancelled = false;
    let unlistenChanged: (() => void) | null = null;
    let unlistenReset: (() => void) | null = null;

    (async () => {
      const loaded = await loadBehavior();
      if (cancelled) return;
      setBehavior(loaded);

      unlistenChanged = await listen<{
        behavior?: BehaviorSettings;
        shortcuts?: Record<string, string>;
        recording?: RecordingPrefs;
        outputPaths?: OutputPathSettings;
        typoFire?: {
          settings: TypoFireSettings;
          matches: TypoFireMatch[];
        };
      }>("settings://changed", async (event) => {
        if (event.payload?.behavior) {
          const nextBehavior = event.payload.behavior;
          setBehavior(nextBehavior);
        } else if (
          !event.payload?.recording &&
          !event.payload?.outputPaths &&
          !event.payload?.typoFire
        ) {
          // Payload pode ser parcial — recarrega behavior do store
          clearAppSettingsCache();
          const fresh = await loadBehavior();
          setBehavior(fresh);
        }
        if (event.payload?.recording) {
          const r = event.payload.recording;
          setMediaState((prev) => applyRecordingPrefsToMediaState(prev, r));
        }
        if (event.payload?.outputPaths) {
          const paths = event.payload.outputPaths;
          setMediaState((prev) => applyOutputPathsToMediaState(prev, paths));
        }
        if (event.payload?.typoFire) {
          try {
            await configureTypoFireEngine(
              event.payload.typoFire.settings,
              event.payload.typoFire.matches,
            );
          } catch (err) {
            console.warn("[toolbar] Typo Fire configure failed:", err);
          }
        }
      });

      unlistenReset = await listen("settings://reset", async () => {
        clearAppSettingsCache();
        const fresh = await loadBehavior();
        setBehavior(fresh);
        const outputPaths = await loadOutputPaths();
        const prefs = await loadRecordingPrefs();
        setMediaState((prev) => ({
          ...applyOutputPathsToMediaState(
            applyRecordingPrefsToMediaState(prev, prefs),
            outputPaths,
          ),
          selectedMicrophone: prefs.selectedMicrophone,
        }));
      });
    })();

    return () => {
      cancelled = true;
      if (unlistenChanged) unlistenChanged();
      if (unlistenReset) unlistenReset();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const outputPaths = await loadOutputPaths();
      if (cancelled) return;
      setMediaState((prev) => applyOutputPathsToMediaState(prev, outputPaths));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Boot: reabre as notas salvas como janelas flutuantes (sticky notes voltam
  // pra tela depois de fechar o app), igual ao Sticky Notes do Windows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const notes = await loadNotes();
        if (cancelled) return;
        for (const note of notes) {
          await openNoteWindow(note);
        }
      } catch (err) {
        console.warn("[toolbar] restore notes failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settings, matches] = await Promise.all([
        loadTypoFireSettings(),
        loadTypoFireMatches(),
      ]);
      if (cancelled) return;
      try {
        await configureTypoFireEngine(settings, matches);
      } catch (err) {
        console.warn("[toolbar] Typo Fire configure failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Aplica always-on-top imediato quando muda.
  useEffect(() => {
    if (!bootedRef.current) return;
    getCurrentWindow().setAlwaysOnTop(behavior.alwaysOnTop).catch(() => {});
  }, [behavior.alwaysOnTop]);

  // Tracking de mouse hover só pelo body (evita re-renders no document).
  // Usa eventos passivos pra não interferir em cliques.
  useEffect(() => {
    // Skip tracking se opacidade inativa = 100 (não há diferença visual)
    if (behavior.inactiveOpacity >= 100) {
      setStageHover(true);
      return;
    }
    const onEnter = () => setStageHover(true);
    const onLeave = () => setStageHover(false);
    document.body.addEventListener("mouseenter", onEnter, { passive: true });
    document.body.addEventListener("mouseleave", onLeave, { passive: true });
    return () => {
      document.body.removeEventListener("mouseenter", onEnter);
      document.body.removeEventListener("mouseleave", onLeave);
    };
  }, [behavior.inactiveOpacity]);

  // Atalhos globais: registra ao boot a partir do store, executa via listener.
  useEffect(() => {
    let cancelled = false;
    let unlistenShortcut: (() => void) | null = null;

    (async () => {
      const map = await loadShortcuts();
      if (cancelled) return;
      for (const [action, accelerator] of Object.entries(map)) {
        if (!accelerator) continue;
        try {
          await invoke("register_shortcut", { action, accelerator });
        } catch (err) {
          console.warn(`[toolbar] register_shortcut ${action} falhou:`, err);
        }
      }

      unlistenShortcut = await listen<{ action: ShortcutAction }>(
        "shortcut://triggered",
        (event) => {
          handleShortcutAction(event.payload.action).catch((err) =>
            console.warn("[toolbar] shortcut action failed:", err),
          );
        },
      );
    })();

    return () => {
      cancelled = true;
      if (unlistenShortcut) unlistenShortcut();
    };
    // handleShortcutAction é estável (definido abaixo via useCallback dependendo de applyState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refs pra acessar estado atual em listeners sem re-registrar
  const stateRef = useRef({ expanded, edge });
  useEffect(() => {
    stateRef.current = { expanded, edge };
  }, [expanded, edge]);

  useEffect(() => {
    behaviorRef.current = behavior;
  }, [behavior]);

  // Flag pra ignorar próximos onMoved disparados por nossos próprios setPosition/setSize
  const ignoreMovesUntilRef = useRef<number>(0);

  // Aplica novo estado da toolbar flutuante: resize + reposicionamento livre.
  const applyState = useCallback(
    async (newExpanded: boolean, _newEdge: EdgeState = "none") => {
      if (applyingRef.current) {
        return;
      }
      applyingRef.current = true;

      const win = getCurrentWindow();
      const curExpanded = stateRef.current.expanded;
      const effectiveEdge: EdgeState = "none";

      let oldX = 0,
        oldY = 0,
        oldW = 142,
        oldH = 142,
        scale = 1,
        monW = 1920,
        monH = 1080,
        monMX = 0,
        monMY = 0;

      try {
        const monitor = await currentMonitor();
        if (monitor) {
          scale = monitor.scaleFactor;
          monW = monitor.size.width / scale;
          monH = monitor.size.height / scale;
          monMX = monitor.position.x / scale;
          monMY = monitor.position.y / scale;
        }
        const oldPos = await win.outerPosition();
        const oldSize = await win.outerSize();
        oldX = oldPos.x / scale;
        oldY = oldPos.y / scale;
        oldW = oldSize.width / scale;
        oldH = oldSize.height / scale;
      } catch (err) {
        console.warn("[toolbar] applyState: erro ao ler estado:", err);
      }

      const [newW, newH] = getVisualTargetSize(
        newExpanded,
        behavior.toolbarOrientation,
        { width: monW, height: monH },
      );

      const screenLeft = monMX + 24;
      const screenTop = monMY + 24;
      const screenRight = monMX + monW - 24;
      const screenBottom = monMY + monH - TASKBAR_RESERVE - 24;
      let nextAnchorSide = anchorSideRef.current;

      if (newExpanded && !curExpanded) {
        if (behavior.toolbarOrientation === "horizontal") {
          const fitsRight = oldX + newW <= screenRight;
          const fitsLeft = oldX + oldW - newW >= screenLeft;
          nextAnchorSide = fitsRight || !fitsLeft ? "start" : "end";
        } else {
          const fitsDown = oldY + newH <= screenBottom;
          const fitsUp = oldY + oldH - newH >= screenTop;
          nextAnchorSide = fitsDown || !fitsUp ? "start" : "end";
        }
      }

      let newX = oldX;
      let newY = oldY;
      if (behavior.toolbarOrientation === "horizontal") {
        newX = nextAnchorSide === "end" ? oldX + oldW - newW : oldX;
        newY = oldY + oldH / 2 - newH / 2;
      } else {
        newX = oldX + oldW / 2 - newW / 2;
        newY = nextAnchorSide === "end" ? oldY + oldH - newH : oldY;
      }

      const safePosition = safeToolbarPosition(
        newX,
        newY,
        newW,
        newH,
        effectiveEdge,
        { x: monMX, y: monMY, width: monW, height: monH },
        TASKBAR_RESERVE,
        24,
      );
      newX = safePosition.x;
      newY = safePosition.y;
      setAnchorSide(nextAnchorSide);

      ignoreMovesUntilRef.current = Date.now() + 900;

      const toRect: WindowRect = {
        x: newX,
        y: newY,
        width: newW,
        height: newH,
      };

      const applyRect = async (rect: WindowRect) => {
        try {
          await Promise.all([
            win.setSize(
              new LogicalSize(
                Math.max(1, Math.round(rect.width)),
                Math.max(1, Math.round(rect.height)),
              ),
            ),
            win.setPosition(
              new LogicalPosition(Math.round(rect.x), Math.round(rect.y))
            ),
          ]);
        } catch (err) {
          console.error("[toolbar] applyRect falhou:", err);
        }
      };

      // Persiste o estado final (posição JÁ conhecida via newX/newY calculados acima),
      // sem precisar ler outerPosition. Evita race com effect [expanded, edge] que
      // pode ler posição antiga antes do doResize completar.
      // Rotation é PRESERVADA — effect [rotation] cuida do save quando muda.
      const persistFinal = () => {
        if (!bootedRef.current) return;
        saveWindowState({
          expanded: newExpanded,
          edge: effectiveEdge,
          x: newX,
          y: newY,
        });
      };

      try {
        setTransitioning(false);
        if (newExpanded && !curExpanded) {
          setHandoffPhase("expanding");
          setSurfaceExpanded(false);
          setExpanded(true);
          setEdge(effectiveEdge);
          await waitForNextFrame();
          await applyRect(toRect);
          await waitForNextFrame();
          setSurfaceExpanded(true);
          await wait(TOOLBAR_GEOMETRY_MS);
          persistFinal();
        } else if (!newExpanded && curExpanded) {
          setHandoffPhase("collapsing");
          await waitForNextFrame();
          setSurfaceExpanded(false);
          await wait(TOOLBAR_GEOMETRY_MS);
          await applyRect(toRect);
          setExpanded(false);
          setEdge(effectiveEdge);
          persistFinal();
        } else {
          setSurfaceExpanded(newExpanded);
          setExpanded(newExpanded);
          setEdge(effectiveEdge);
          await applyRect(toRect);
          persistFinal();
        }
      } finally {
        setHandoffPhase("idle");
        applyingRef.current = false;
      }
    },
    [behavior.toolbarOrientation, getVisualTargetSize]
  );

  const collapseToolbarForBlur = useCallback(async () => {
    if (!bootedRef.current) return;
    if (!behaviorRef.current.autoHide) return;
    if (!stateRef.current.expanded) return;
    if (applyingRef.current) return;
    await applyState(false, "none");
  }, [applyState]);

  // Auto-hide: colapsa toolbar ao perder foco se ligado.
  // O listener fica sempre registrado e consulta behaviorRef para não perder
  // mudanças feitas na janela de Configurações enquanto a toolbar já está sem foco.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onFocusChanged(({ payload: focused }) => {
        if (focused) return;
        collapseToolbarForBlur().catch((err) => {
          console.warn("[toolbar] auto-hide blur failed:", err);
        });
      });
      try {
        if (!cancelled && !(await win.isFocused())) {
          await collapseToolbarForBlur();
        }
      } catch {
        // isFocused pode falhar no preview sem Tauri; o evento cobre runtime real.
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [collapseToolbarForBlur]);

  useEffect(() => {
    if (!behavior.autoHide) return;
    getCurrentWindow()
      .isFocused()
      .then((focused) => {
        if (!focused) return collapseToolbarForBlur();
      })
      .catch(() => {});
  }, [behavior.autoHide, collapseToolbarForBlur]);

  useEffect(() => {
    if (!bootedRef.current) return;
    const { expanded: curExpanded, edge: curEdge } = stateRef.current;
    applyState(curExpanded, curEdge).catch((err) => {
      console.warn("[toolbar] visual mode resize failed:", err);
    });
  }, [applyState]);

  // Boot: hidrata do store e revela quando pronto.
  // Safety margin de 50ms pra garantir que WebView2 e React estão em estado
  // estável antes da transição de opacity (320ms) começar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateFromStore();
      if (cancelled) return;
      await new Promise<void>((r) => setTimeout(r, 50));
      if (cancelled) return;
      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateFromStore]);

  // Save de rotation: roda a cada frame do scroll, mas é leve (só patch debounced,
  // sem I/O de outerPosition). Saves de expanded/edge/x/y agora rodam DENTRO de
  // applyState (depois de doResize), pra ter posição exata sem race condition.
  useEffect(() => {
    if (!bootedRef.current) return;
    saveWindowState({ rotation });
  }, [rotation]);

  // Drag-and-drop de arquivos do Windows
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onDragDropEvent((event) => {
        const t = event.payload.type;
        if (t === "drop") {
          const paths = event.payload.paths;
          setDroppedFiles((prev) => [...prev, ...paths]);
          setIsDraggingOver(false);
        } else if (t === "enter" || t === "over") {
          setIsDraggingOver(true);
        } else if (t === "leave") {
          setIsDraggingOver(false);
        }
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // onMoved persiste posição livre; não há mais detecção de borda/snap.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let timeoutId: number | null = null;

    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onMoved(({ payload }) => {
        if (Date.now() < ignoreMovesUntilRef.current) return;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(async () => {
          try {
            const monitor = await currentMonitor();
            if (!monitor) return;
            const scale = monitor.scaleFactor;
            saveWindowState({
              x: payload.x / scale,
              y: payload.y / scale,
              edge: "none",
            });
          } catch {}
        }, 200);
      });
    })();
    return () => {
      if (unlisten) unlisten();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);

  async function handleAction(id: ActionId) {
    if (id === "close") {
      try {
        // Flush garante que o estado mais recente foi salvo antes da janela sumir
        await flushSettings();
        await invoke("hide_to_tray");
      } catch (err) {
        console.error("[toolbar] erro ao hide:", err);
      }
      return;
    }
    if (id === "system") {
      try {
        await invoke("open_settings_window");
      } catch (err) {
        const message = userFacingError(
          err,
          "Não foi possível abrir as configurações.",
        );
        setActionFeedback(`Configurações: ${message}`);
        console.error("[toolbar] open_settings_window falhou:", err);
      }
      return;
    }
    if (id === "download") {
      try {
        await invoke("open_downloads_window");
      } catch (err) {
        const message = userFacingError(
          err,
          "Nao foi possivel abrir os downloads.",
        );
        setActionFeedback(`Downloads: ${message}`);
        console.error("[toolbar] open_downloads_window falhou:", err);
      }
      return;
    }
    if (id === "mixer") {
      try {
        await invoke("open_media_mixer_window");
      } catch (err) {
        const message = userFacingError(
          err,
          "Nao foi possivel abrir o mixer.",
        );
        setActionFeedback(`Mixer: ${message}`);
        console.error("[toolbar] open_media_mixer_window falhou:", err);
      }
      return;
    }
    if (
      id === "typoFire" ||
      id === "todoCalendar" ||
      id === "pomodoro"
    ) {
      const command =
        id === "typoFire"
          ? "open_typo_fire_window"
          : id === "todoCalendar"
          ? "open_todo_calendar_window"
          : "open_pomodoro_window";
      const label = id === "typoFire"
        ? "Typo Fire"
        : id === "todoCalendar"
        ? "Calendário"
        : "Pomodoro";
      try {
        await invoke(command);
      } catch (err) {
        const message = userFacingError(
          err,
          `Não foi possível abrir ${label.toLowerCase()}.`,
        );
        setActionFeedback(`${label}: ${message}`);
        console.error(`[toolbar] ${command} falhou:`, err);
      }
      return;
    }
    if (id === "capture" || id === "record") {
      const shouldGuardRecording = id === "record";
      if (
        shouldIgnoreMediaAction(id as MediaActionId, mediaActionPendingRef.current)
      ) {
        return;
      }
      if (shouldGuardRecording) {
        mediaActionPendingRef.current = true;
        setMediaActionPending(true);
        setActionFeedback(recordingPendingFeedback(mediaStateRef.current.isRecording));
        await waitForNextFrame();
      }
      try {
        await runMediaAction(id as MediaActionId, {
          getState: () => mediaStateRef.current,
          invoke,
          setState: setMediaState,
          setFeedback: setActionFeedback,
          runtimeReadiness,
        });
      } catch (err) {
        const message = userFacingError(
          err,
          id === "capture"
            ? "Nao foi possivel salvar o print."
            : "Gravacao de tela indisponivel nesta instalacao.",
        );
        setActionFeedback(message);
        console.error(`[toolbar] ${id} falhou:`, err);
      } finally {
        if (shouldGuardRecording) {
          mediaActionPendingRef.current = false;
          setMediaActionPending(false);
        }
      }
      return;
    }
    if (id === "dictate") {
      try {
        await runSpeechAction({
          getState: () => speechStateRef.current,
          invoke,
          setState: setSpeechState,
          setFeedback: setActionFeedback,
        });
      } catch (err) {
        setSpeechState((prev) => ({
          ...prev,
          isDictating: false,
          isTranscribing: false,
        }));
        const fallback = "Ditado do Windows nao abriu. Tente novamente no app ativo.";
        const message = userFacingError(
          err,
          fallback,
        );
        setActionFeedback(message.startsWith("Ditado") ? message : fallback);
        console.error("[toolbar] dictate falhou:", err);
      }
      return;
    }
    if (id === "notes") {
      try {
        // Toggle: se ja ha notas na tela, oculta todas; senao abre/cria.
        const anyOpen = await invoke<boolean>("any_note_window_open");
        if (anyOpen) {
          await invoke("close_all_note_windows");
          return;
        }
        clearNotesCache();
        const notes = await loadNotes();
        if (notes.length === 0) {
          const created = await createNote();
          await openNoteWindow(created);
        } else {
          // Reabre/foca todas as notas salvas (sticky notes voltam pra tela).
          for (const note of notes) {
            await openNoteWindow(note);
          }
        }
      } catch (err) {
        const message = userFacingError(
          err,
          "Nao foi possivel abrir as notas.",
        );
        setActionFeedback(`Notas: ${message}`);
        console.error("[toolbar] notes falhou:", err);
      }
      return;
    }
  }

  // Executor de atalho global vindo do backend.
  async function handleShortcutAction(action: ShortcutAction) {
    switch (action) {
      case "toggle_toolbar": {
        // Sempre mostra: melhor UX pra "summon" via atalho
        try {
          await invoke("show_window");
        } catch (err) {
          console.warn("[shortcut] toggle_toolbar:", err);
        }
        return;
      }
      case "toggle_expanded": {
        const { expanded: curExpanded } = stateRef.current;
        applyState(!curExpanded, "none").catch(() => {});
        return;
      }
      case "capture": {
        await handleAction("capture");
        return;
      }
      case "toggle_recording": {
        await handleAction("record");
        return;
      }
      case "toggle_dictation": {
        await handleAction("dictate");
        return;
      }
      case "open_settings": {
        await handleAction("system");
        return;
      }
      case "open_mixer": {
        await handleAction("mixer");
        return;
      }
      case "open_todo_calendar":
      case "quick_add_todo": {
        await handleAction("todoCalendar");
        return;
      }
      case "open_pomodoro": {
        await handleAction("pomodoro");
        return;
      }
      case "pomodoro_start_pause": {
        try {
          const state = await invoke<{
            pomodoroTimer: { status: "idle" | "running" | "paused" };
          }>("productivity_get_state");
          if (state.pomodoroTimer.status === "running") {
            await invoke("pomodoro_pause_timer");
            stopPomodoroAlarm();
            setActionFeedback("Pomodoro pausado");
          } else if (state.pomodoroTimer.status === "paused") {
            await invoke("pomodoro_resume_timer");
            stopPomodoroAlarm();
            setActionFeedback("Pomodoro retomado");
          } else {
            await invoke("pomodoro_start_timer", { activeTodoId: null });
            stopPomodoroAlarm();
            setActionFeedback("Pomodoro iniciado");
          }
        } catch (err) {
          const message = userFacingError(
            err,
            "Nao foi possivel controlar o Pomodoro.",
          );
          setActionFeedback(`Pomodoro: ${message}`);
        }
        return;
      }
      case "media_play_pause": {
        try {
          await invoke("media_mixer_transport", { action: "playPause" });
          setActionFeedback("Midia: play/pause");
        } catch (err) {
          const message = userFacingError(
            err,
            "Este app nao aceitou o comando de midia.",
          );
          setActionFeedback(`Midia: ${message}`);
        }
        return;
      }
      case "media_next": {
        try {
          await invoke("media_mixer_transport", { action: "next" });
          setActionFeedback("Midia: proxima");
        } catch (err) {
          const message = userFacingError(
            err,
            "Este app nao aceitou o comando de midia.",
          );
          setActionFeedback(`Midia: ${message}`);
        }
        return;
      }
      case "media_previous": {
        try {
          await invoke("media_mixer_transport", { action: "previous" });
          setActionFeedback("Midia: anterior");
        } catch (err) {
          const message = userFacingError(
            err,
            "Este app nao aceitou o comando de midia.",
          );
          setActionFeedback(`Midia: ${message}`);
        }
        return;
      }
      case "media_mute": {
        try {
          const snapshot = await invoke<{ master: { muted: boolean } }>(
            "media_mixer_snapshot",
          );
          await invoke("media_mixer_set_master_muted", {
            muted: !snapshot.master.muted,
          });
          setActionFeedback(
            `Volume geral ${snapshot.master.muted ? "ativado" : "mutado"}`,
          );
        } catch (err) {
          const message = userFacingError(
            err,
            "Nao foi possivel alterar o mute geral.",
          );
          setActionFeedback(`Midia: ${message}`);
        }
        return;
      }
      case "typo_fire_toggle": {
        try {
          const status = await invoke<{ enabled: boolean }>("typo_fire_status");
          await saveTypoFireSettings({ enabled: !status.enabled });
          const next = await invoke<{ enabled: boolean }>("typo_fire_set_enabled", {
            enabled: !status.enabled,
          });
          setActionFeedback(`Typo Fire ${next.enabled ? "ligado" : "pausado"}`);
        } catch (err) {
          const message = userFacingError(
            err,
            "Nao foi possivel alterar o Typo Fire.",
          );
          setActionFeedback(`Typo Fire: ${message}`);
        }
        return;
      }
      case "typo_fire_search": {
        try {
          await handleAction("typoFire");
        } catch (err) {
          const message = userFacingError(
            err,
            "Nao foi possivel abrir o Typo Fire.",
          );
          setActionFeedback(`Typo Fire: ${message}`);
        }
        return;
      }
      case "typo_fire_reload": {
        try {
          await invoke("typo_fire_reload");
          setActionFeedback("Typo Fire recarregado");
        } catch (err) {
          const message = userFacingError(
            err,
            "Nao foi possivel recarregar o Typo Fire.",
          );
          setActionFeedback(`Typo Fire: ${message}`);
        }
        return;
      }
    }
  }

  // Drag manual com clamp DENTRO da tela.
  // Substitui startDragging() (nativo do Windows) que permitia mover
  // a janela pra metade fora da tela.
  const startManualDrag = useCallback(
    (e: React.MouseEvent, onIdleClick?: () => void) => {
      if (e.button !== 0) return;
      const startScreenX = e.screenX;
      const startScreenY = e.screenY;
      const offsetX = e.clientX;
      const offsetY = e.clientY;
      let dragged = false;
      let initialized = false;
      let monX = 0,
        monY = 0,
        monW = 1920,
        monH = 1080;
      let curW = 142,
        curH = 142;

      (async () => {
        try {
          const win = getCurrentWindow();
          const monitor = await currentMonitor();
          let scale = 1;
          if (monitor) {
            scale = monitor.scaleFactor;
            monX = monitor.position.x / scale;
            monY = monitor.position.y / scale;
            monW = monitor.size.width / scale;
            monH = monitor.size.height / scale;
          }
          const size = await win.outerSize();
          curW = size.width / scale;
          curH = size.height / scale;
          initialized = true;
        } catch (err) {
          console.error("[toolbar] drag init falhou:", err);
        }
      })();

      const onMove = (ev: MouseEvent) => {
        const dx = ev.screenX - startScreenX;
        const dy = ev.screenY - startScreenY;
        if (
          !dragged &&
          (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)
        ) {
          dragged = true;
        }
        if (dragged && initialized) {
          // posição da janela = (cursor global) - (offset onde clicou)
          const targetX = ev.screenX - offsetX;
          const targetY = ev.screenY - offsetY;
          const newX = Math.max(
            monX,
            Math.min(monX + monW - curW, targetX)
          );
          const newY = Math.max(
            monY,
            Math.min(monY + monH - curH - TASKBAR_RESERVE, targetY)
          );
          ignoreMovesUntilRef.current = Date.now() + 300;
          getCurrentWindow()
            .setPosition(new LogicalPosition(Math.round(newX), Math.round(newY)))
            .catch(() => {});
        }
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (dragged) {
          (async () => {
            if (!bootedRef.current) return;
            try {
              const win = getCurrentWindow();
              const pos = await win.outerPosition();
              const mon = await currentMonitor();
              const s = mon?.scaleFactor ?? 1;
              saveWindowState({ x: pos.x / s, y: pos.y / s, edge: "none" });
            } catch (err) {
              console.warn("[drag] save posição falhou:", err);
            }
          })();
        } else if (onIdleClick) {
          onIdleClick();
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    []
  );

  // core-btn: drag manual; click curto sem drag = toggle expand/collapse
  const handleCoreMouseDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      startManualDrag(e, () => {
        const { expanded: curExpanded } = stateRef.current;
        applyState(!curExpanded, "none");
      });
    },
    [startManualDrag, applyState]
  );

  const handleToolbarSurfaceMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      startManualDrag(e);
    },
    [startManualDrag]
  );

  const actions: ToolbarAction[] = buildToolbarActions({
    mediaActionPending,
    mediaState,
    speechState,
  });
  const toolbarOrientation = behavior.toolbarOrientation;
  // Aplica opacidade inativa quando o cursor sai da janela.
  const inactiveOpacity = behavior.inactiveOpacity / 100;
  const stageOpacity = stageHover ? 1 : inactiveOpacity;
  const stageClass = [
    "stage",
    "toolbar-floating",
    expanded ? "expanded" : "collapsed",
    `edge-${edge}`,
    `toolbar-orientation-${toolbarOrientation}`,
    `toolbar-anchor-${anchorSide}`,
    mediaState.isRecording ? "is-recording" : "",
    mediaActionPending ? "is-media-pending" : "",
    speechState.isDictating || speechState.isTranscribing ? "is-dictating" : "",
    isDraggingOver ? "drop-active" : "",
    transitioning || booting ? "transitioning" : "",
    handoffPhase !== "idle" ? `handoff-${handoffPhase}` : "",
    expanded && !surfaceExpanded ? "surface-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={stageClass}
      style={
        {
          "--stage-opacity": stageOpacity,
          "--floating-action-count": actions.length,
        } as React.CSSProperties
      }
    >
      {expanded ? (
        <SnapLiquidSurface
          className={`floating-toolbar-surface is-${toolbarOrientation}`}
          onMouseDown={handleToolbarSurfaceMouseDown}
        >
          <button
            className="floating-toolbar-control"
            onMouseDown={handleCoreMouseDown}
            title="Recolher"
            type="button"
          >
            <Minus size={28} strokeWidth={1.9} absoluteStrokeWidth />
            <span className="sr-only">Recolher toolbar</span>
          </button>

          <div
            className="floating-toolbar-actions"
            role="toolbar"
            aria-orientation={toolbarOrientation}
            aria-label="Ações do Snapbar"
          >
            {actions.map((action, index) => {
              const Icon = action.Icon;
              return (
                <button
                  key={action.id}
                  className={[
                    "floating-toolbar-action",
                    action.active ? action.activeClass ?? "active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={
                    {
                      "--floating-index": index,
                    } as React.CSSProperties
                  }
                  aria-label={action.label}
                  type="button"
                  disabled={action.disabled}
                  aria-busy={action.disabled ? "true" : undefined}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => handleAction(action.id)}
                >
                  <Icon size={28} strokeWidth={1.9} absoluteStrokeWidth />
                  <span className="sr-only">{action.label}</span>
                </button>
              );
            })}
          </div>

          <button
            className="floating-toolbar-hide"
            title="Esconder toolbar"
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => handleAction("close")}
          >
            <X size={26} strokeWidth={1.9} absoluteStrokeWidth />
            <span className="sr-only">Esconder toolbar</span>
          </button>

          {handoffPhase === "collapsing" && (
            <Plus
              aria-hidden="true"
              className="floating-toolbar-handoff-plus"
              size={46}
              strokeWidth={1.65}
              absoluteStrokeWidth
            />
          )}
        </SnapLiquidSurface>
      ) : (
        <SnapLiquidButtonSurface
          className="floating-toolbar-collapsed"
          onMouseDown={handleCoreMouseDown}
          title="Expandir"
          type="button"
        >
          <Plus size={46} strokeWidth={1.65} absoluteStrokeWidth />
          <span className="sr-only">Expandir toolbar</span>
        </SnapLiquidButtonSurface>
      )}

      {expanded && (droppedFiles.length > 0 || mediaState.isRecording || actionFeedback) && (
        <div className="floating-toolbar-status-row" role="status" aria-live="polite" aria-atomic="true">
          {mediaState.isRecording && (
            <span className="recording-indicator">
              <span aria-hidden="true">REC</span>
              <span className="sr-only">Gravação em andamento</span>
            </span>
          )}
          {droppedFiles.length > 0 && (
            <span className="drop-counter">
              {droppedFiles.length} arquivo
              {droppedFiles.length === 1 ? "" : "s"} recebido
              {droppedFiles.length === 1 ? "" : "s"}
            </span>
          )}
          {actionFeedback && (
            <span className="action-feedback" title={actionFeedback}>
              {actionFeedback}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return <ToolbarApp />;
}
