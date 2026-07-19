import { describe, expect, it } from "vitest";
import {
  runSpeechAction,
  type SpeechActionContext,
  type InvokeFn,
  type SpeechActionState,
} from "./speech-actions";

function createHarness(initial: SpeechActionState = { isDictating: false, isTranscribing: false }) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const feedback: string[] = [];
  let state = initial;

  const invoke: InvokeFn = async <T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    calls.push({ command, args });
    if (command === "toggle_windows_voice_typing") {
      return { triggered: true } as T;
    }
    throw new Error(`unexpected command: ${command}`);
  };

  const context: SpeechActionContext = {
    getState: () => state,
    invoke,
    setState: (next: SpeechActionState) => {
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

describe("runSpeechAction", () => {
  it("toggles Windows voice typing without local transcription options", async () => {
    const harness = createHarness({
      isDictating: false,
      isTranscribing: false,
    });

    await runSpeechAction(harness.context);

    expect(harness.calls).toEqual([
      {
        command: "toggle_windows_voice_typing",
        args: undefined,
      },
    ]);
    expect(harness.state).toMatchObject({ isDictating: false, isTranscribing: false });
    expect(harness.feedback[harness.feedback.length - 1]).toBe("Digitação por voz");
  });

  it("surfaces a Windows voice typing failure without mentioning offline mode", async () => {
    const harness = createHarness({
      isDictating: false,
      isTranscribing: false,
    });
    harness.context.invoke = async (command: string) => {
      harness.calls.push({ command });
      throw new Error("hook failed");
    };

    await runSpeechAction(harness.context);

    expect(harness.calls).toEqual([{ command: "toggle_windows_voice_typing" }]);
    expect(harness.feedback[harness.feedback.length - 1]).toBe(
      "Ditado do Windows nao abriu. Tente novamente no app ativo.",
    );
  });
});
