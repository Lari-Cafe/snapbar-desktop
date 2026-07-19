import { describe, expect, it } from "vitest";
import {
  runMediaAction,
  shouldIgnoreMediaAction,
  type MediaActionContext,
  type InvokeFn,
  type MediaActionState,
} from "./media-actions";

function createHarness(initial: MediaActionState = { isRecording: false }) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const feedback: string[] = [];
  let state = initial;

  const invoke: InvokeFn = async <T = unknown>(command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "capture_screen") return "C:\\shots\\screenshot.png" as T;
    if (command === "start_screen_recording") {
      return {
        isRecording: true,
        outputPath: "C:\\videos\\recording.mp4",
        audioSources: ["Microphone (fifine Microphone)", "Stereo Mix"],
      } as T;
    }
    if (command === "stop_screen_recording") {
      return {
        isRecording: false,
        outputPath: "C:\\videos\\recording.mp4",
        audioSources: ["Microphone (fifine Microphone)", "Stereo Mix"],
      } as T;
    }
    throw new Error(`unexpected command: ${command}`);
  };

  const context: MediaActionContext = {
    getState: () => state,
    invoke,
    setState: (next: MediaActionState) => {
      state = next;
    },
    setFeedback: (message: string) => {
      feedback.push(message);
    },
  };

  return {
    calls,
    feedback,
    get state() {
      return state;
    },
    context,
  };
}

function createWarningHarness(initial: MediaActionState = { isRecording: false }) {
  const harness = createHarness(initial);
  harness.context.invoke = async <T = unknown>(command: string, args?: Record<string, unknown>) => {
    harness.calls.push({ command, args });
    if (command === "start_screen_recording") {
      return {
        isRecording: true,
        outputPath: "C:\\videos\\recording.mp4",
        audioSources: ["Microphone (fifine Microphone)"],
        warning: "audio do sistema nao encontrado; gravando microfone se disponivel",
      } as T;
    }
    throw new Error(`unexpected command: ${command}`);
  };
  return harness;
}

describe("runMediaAction", () => {
  it("blocks repeated recording clicks while a recording command is pending", () => {
    expect(shouldIgnoreMediaAction("record", true)).toBe(true);
    expect(shouldIgnoreMediaAction("record", false)).toBe(false);
    expect(shouldIgnoreMediaAction("capture", true)).toBe(false);
  });

  it("captures the screen through the Tauri command", async () => {
    const harness = createHarness();

    await runMediaAction("capture", harness.context);

    expect(harness.calls).toEqual([{ command: "capture_screen", args: undefined }]);
    expect(harness.feedback[0]).toBe("Selecione a area do print...");
    expect(harness.feedback[harness.feedback.length - 1]).toContain("screenshot.png");
    expect(harness.feedback[harness.feedback.length - 1]).toContain("Print salvo");
  });

  it("passes the configured screenshot folder to the capture command", async () => {
    const harness = createHarness({
      isRecording: false,
      screenshotOutputDir: "D:\\Snapbar\\Prints",
    });

    await runMediaAction("capture", harness.context);

    expect(harness.calls).toEqual([
      {
        command: "capture_screen",
        args: { options: { outputDir: "D:\\Snapbar\\Prints" } },
      },
    ]);
  });

  it("starts continuous screen recording when idle", async () => {
    const harness = createHarness({ isRecording: false });

    await runMediaAction("record", harness.context);

    expect(harness.calls).toEqual([
      {
        command: "start_screen_recording",
        args: {
          options: {
            includeMicrophone: true,
            includeSystemAudio: true,
            microphoneDevice: null,
          },
        },
      },
    ]);
    expect(harness.state).toEqual({
      isRecording: true,
      outputPath: "C:\\videos\\recording.mp4",
      audioSources: ["Microphone (fifine Microphone)", "Stereo Mix"],
    });
    expect(harness.feedback[0]).toBe("Preparando gravacao...");
    expect(harness.feedback[harness.feedback.length - 1]).toContain("Gravando com audio");
  });

  it("stops continuous screen recording when already recording", async () => {
    const harness = createHarness({
      isRecording: true,
      outputPath: "C:\\videos\\recording.mp4",
    });

    await runMediaAction("record", harness.context);

    expect(harness.calls).toEqual([
      { command: "stop_screen_recording", args: undefined },
    ]);
    expect(harness.state).toEqual({
      isRecording: false,
      outputPath: "C:\\videos\\recording.mp4",
      audioSources: ["Microphone (fifine Microphone)", "Stereo Mix"],
    });
    expect(harness.feedback[harness.feedback.length - 1]).toContain("recording.mp4");
  });

  it("passes selected microphone and audio toggles to the recording command", async () => {
    const harness = createHarness({
      isRecording: false,
      includeMicrophone: false,
      includeSystemAudio: true,
      selectedMicrophone: "Microphone (Fuxi-H3 )",
      recordingOutputDir: "D:\\Snapbar\\Videos",
    });

    await runMediaAction("record", harness.context);

    expect(harness.calls).toEqual([
      {
        command: "start_screen_recording",
        args: {
          options: {
            includeMicrophone: false,
            includeSystemAudio: true,
            microphoneDevice: "Microphone (Fuxi-H3 )",
            outputDir: "D:\\Snapbar\\Videos",
          },
        },
      },
    ]);
  });

  it("surfaces missing system audio as the main recording feedback", async () => {
    const harness = createWarningHarness({ isRecording: false });

    await runMediaAction("record", harness.context);

    expect(harness.feedback[harness.feedback.length - 1]).toContain("Sem audio do sistema");
    expect(harness.feedback[harness.feedback.length - 1]).toContain("Microphone (fifine Microphone)");
  });

  it("does not start recording when runtime assets are unavailable", async () => {
    const harness = createHarness({ isRecording: false });
    harness.context.runtimeReadiness = {
      assets: [
        {
          id: "ffmpeg",
          feature: "recording",
          status: "missing",
          repairAvailable: true,
          userMessage: "Gravacao indisponivel nesta instalacao.",
        },
      ],
    };

    await runMediaAction("record", harness.context);

    expect(harness.calls).toEqual([]);
    expect(harness.feedback[harness.feedback.length - 1]).toBe(
      "Gravacao indisponivel nesta instalacao.",
    );
  });
});
