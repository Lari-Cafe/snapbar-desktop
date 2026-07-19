import {
  featureAvailable,
  featureMessage,
  type RuntimeReadiness,
} from "./runtime-readiness";

export type MediaActionId = "capture" | "record";

export interface MediaActionState {
  isRecording: boolean;
  outputPath?: string;
  audioSources?: string[];
  includeMicrophone?: boolean;
  includeSystemAudio?: boolean;
  selectedMicrophone?: string;
  screenshotOutputDir?: string;
  recordingOutputDir?: string;
  warning?: string;
}

export interface RecordingCommandResult {
  isRecording: boolean;
  outputPath: string;
  audioSources: string[];
  warning?: string;
}

export type InvokeFn = <T = unknown>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export interface MediaActionContext {
  getState: () => MediaActionState;
  invoke: InvokeFn;
  setState: (next: MediaActionState) => void;
  setFeedback: (message: string) => void;
  runtimeReadiness?: RuntimeReadiness | null;
}

export function shouldIgnoreMediaAction(
  id: MediaActionId,
  isPending: boolean,
): boolean {
  return id === "record" && isPending;
}

export async function runMediaAction(
  id: MediaActionId,
  context: MediaActionContext,
): Promise<void> {
  if (id === "capture") {
    const options = getCaptureOptions(context.getState());
    const args = options ? { options } : undefined;
    context.setFeedback("Selecione a area do print...");
    const path = await context.invoke<string>("capture_screen", args);
    context.setFeedback(`Print salvo: ${basename(path)}`);
    return;
  }

  const current = context.getState();
  if (
    !current.isRecording &&
    context.runtimeReadiness &&
    !featureAvailable(context.runtimeReadiness, "recording")
  ) {
    context.setFeedback(
      featureMessage(
        context.runtimeReadiness,
        "recording",
        "Gravacao indisponivel nesta instalacao.",
      ),
    );
    return;
  }

  const command = current.isRecording
    ? "stop_screen_recording"
    : "start_screen_recording";
  const args = current.isRecording
    ? undefined
    : { options: getRecordingOptions(current) };
  if (!current.isRecording) {
    context.setFeedback("Preparando gravacao...");
  }
  const next = await context.invoke<RecordingCommandResult>(command, args);
  context.setState({ ...current, ...next });

  if (next.isRecording) {
    if (next.warning) {
      const sourceLabel =
        next.audioSources.length > 0 ? next.audioSources.join(" + ") : "somente tela";
      context.setFeedback(`Sem audio do sistema. Gravando: ${sourceLabel}`);
      return;
    }

    const audioLabel =
      next.audioSources.length > 0
        ? `com audio: ${next.audioSources.join(" + ")}`
        : "sem audio detectado";
    context.setFeedback(`Gravando ${audioLabel}`);
    return;
  }

  context.setFeedback(`Gravacao salva: ${basename(next.outputPath)}`);
}

export function getRecordingOptions(state: MediaActionState) {
  const options: {
    includeMicrophone: boolean;
    includeSystemAudio: boolean;
    microphoneDevice: string | null;
    outputDir?: string;
  } = {
    includeMicrophone: state.includeMicrophone ?? true,
    includeSystemAudio: state.includeSystemAudio ?? true,
    microphoneDevice: state.selectedMicrophone ?? null,
  };
  if (state.recordingOutputDir) options.outputDir = state.recordingOutputDir;
  return options;
}

function getCaptureOptions(state: MediaActionState): { outputDir: string } | null {
  if (!state.screenshotOutputDir) return null;
  return { outputDir: state.screenshotOutputDir };
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}
