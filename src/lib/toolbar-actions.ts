import {
  Bookmark,
  CalendarDays,
  Camera,
  CircleStop,
  Download,
  Flame,
  Mic,
  Settings,
  SlidersHorizontal,
  TimerReset,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { MediaActionState } from "./media-actions";
import type { SpeechActionState } from "./speech-actions";

export type ActionId =
  | "capture"
  | "record"
  | "dictate"
  | "download"
  | "mixer"
  | "typoFire"
  | "todoCalendar"
  | "pomodoro"
  | "system"
  | "notes"
  | "close";

export interface ToolbarAction {
  id: ActionId;
  label: string;
  Icon: LucideIcon;
  variant?: "default" | "danger";
  active?: boolean;
  activeClass?: string;
  disabled?: boolean;
}

interface BuildToolbarActionsInput {
  mediaActionPending: boolean;
  mediaState: Pick<MediaActionState, "isRecording">;
  speechState: Pick<SpeechActionState, "isDictating" | "isTranscribing">;
}

export function buildToolbarActions({
  mediaActionPending,
  mediaState,
  speechState,
}: BuildToolbarActionsInput): ToolbarAction[] {
  return [
    {
      id: "record",
      label: mediaActionPending
        ? mediaState.isRecording
          ? "Finalizando gravação"
          : "Preparando gravação"
        : mediaState.isRecording
          ? "Parar gravação"
          : "Gravar tela",
      Icon: mediaState.isRecording ? CircleStop : Video,
      active: mediaState.isRecording || mediaActionPending,
      disabled: mediaActionPending,
    },
    {
      id: "dictate",
      label: "Digitação por voz",
      Icon: Mic,
      active: speechState.isDictating || speechState.isTranscribing,
      activeClass: "listening",
    },
    { id: "download", label: "Downloads", Icon: Download },
    { id: "mixer", label: "Mixer", Icon: SlidersHorizontal },
    { id: "todoCalendar", label: "Calendário", Icon: CalendarDays },
    { id: "pomodoro", label: "Pomodoro", Icon: TimerReset },
    { id: "notes", label: "Notas", Icon: Bookmark },
    { id: "capture", label: "Print", Icon: Camera },
    { id: "typoFire", label: "Typo Fire", Icon: Flame },
    { id: "system", label: "Sistema", Icon: Settings },
  ];
}
