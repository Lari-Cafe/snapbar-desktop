import { describe, expect, it } from "vitest";
import { buildToolbarActions } from "./toolbar-actions";

const idleMedia = { isRecording: false };
const idleSpeech = { isDictating: false, isTranscribing: false };

describe("toolbar actions", () => {
  it("keeps the Snapbar action order stable", () => {
    expect(
      buildToolbarActions({
        mediaActionPending: false,
        mediaState: idleMedia,
        speechState: idleSpeech,
      }).map((action) => action.id),
    ).toEqual([
      "record",
      "dictate",
      "download",
      "mixer",
      "todoCalendar",
      "pomodoro",
      "notes",
      "capture",
      "typoFire",
      "system",
    ]);
  });

  it("labels the recording action from recording and pending state", () => {
    expect(
      buildToolbarActions({
        mediaActionPending: false,
        mediaState: idleMedia,
        speechState: idleSpeech,
      })[0],
    ).toMatchObject({ label: "Gravar tela", active: false, disabled: false });

    expect(
      buildToolbarActions({
        mediaActionPending: false,
        mediaState: { isRecording: true },
        speechState: idleSpeech,
      })[0],
    ).toMatchObject({ label: "Parar gravação", active: true, disabled: false });

    expect(
      buildToolbarActions({
        mediaActionPending: true,
        mediaState: { isRecording: true },
        speechState: idleSpeech,
      })[0],
    ).toMatchObject({ label: "Finalizando gravação", active: true, disabled: true });
  });

  it("marks dictation active while dictating or transcribing", () => {
    expect(
      buildToolbarActions({
        mediaActionPending: false,
        mediaState: idleMedia,
        speechState: { isDictating: true, isTranscribing: false },
      })[1],
    ).toMatchObject({ id: "dictate", active: true, activeClass: "listening" });
  });
});
