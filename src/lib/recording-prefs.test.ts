import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECORDING_PREFS,
  normalizeRecordingPrefs,
} from "./recording-prefs";

describe("recording preferences", () => {
  it("keeps valid recording options and trims the selected microphone", () => {
    expect(
      normalizeRecordingPrefs({
        includeMicrophone: false,
        includeSystemAudio: true,
        selectedMicrophone: "  Microphone (Fuxi-H3)  ",
      }),
    ).toEqual({
      includeMicrophone: false,
      includeSystemAudio: true,
      selectedMicrophone: "Microphone (Fuxi-H3)",
    });
  });

  it("falls back to defaults for invalid persisted values", () => {
    expect(
      normalizeRecordingPrefs({
        includeMicrophone: "yes",
        includeSystemAudio: null,
        selectedMicrophone: " ",
      }),
    ).toEqual(DEFAULT_RECORDING_PREFS);
  });
});
