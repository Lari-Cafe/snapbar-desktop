import { userFacingError } from "./user-facing-errors";

export interface SpeechActionState {
  isDictating: boolean;
  isTranscribing: boolean;
}

export interface WindowsVoiceTypingStatus {
  triggered: boolean;
  warning?: string | null;
}

export type InvokeFn = <T = unknown>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export interface SpeechActionContext {
  getState: () => SpeechActionState;
  invoke: InvokeFn;
  setState: (next: SpeechActionState) => void;
  setFeedback: (message: string) => void;
}

const WINDOWS_VOICE_TYPING_FALLBACK =
  "Ditado do Windows nao abriu. Tente novamente no app ativo.";

export async function runSpeechAction(
  context: SpeechActionContext,
): Promise<void> {
  const current = context.getState();
  context.setState({ ...current, isDictating: false, isTranscribing: false });

  try {
    const next = await context.invoke<WindowsVoiceTypingStatus>(
      "toggle_windows_voice_typing",
    );
    context.setFeedback(next.warning?.trim() || "Digitação por voz");
  } catch (err) {
    const message = userFacingError(err, WINDOWS_VOICE_TYPING_FALLBACK);
    context.setFeedback(message.startsWith("Ditado") ? message : WINDOWS_VOICE_TYPING_FALLBACK);
  }
}
