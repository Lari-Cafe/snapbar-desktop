import { describe, expect, it } from "vitest";
import {
  clampMixerVolume,
  isMediaTransportAction,
  mediaMixerStatusText,
  normalizeMixerSessions,
  type MediaMixerSnapshot,
} from "./media-mixer";

describe("media mixer helpers", () => {
  it("clamps finite volume values to the backend scalar range", () => {
    expect(clampMixerVolume(-0.2)).toBe(0);
    expect(clampMixerVolume(0.42)).toBe(0.42);
    expect(clampMixerVolume(1.8)).toBe(1);
  });

  it("rejects non-finite volume values before invoking native commands", () => {
    expect(() => clampMixerVolume(Number.NaN)).toThrow("Volume invalido");
    expect(() => clampMixerVolume(Number.POSITIVE_INFINITY)).toThrow(
      "Volume invalido",
    );
  });

  it("recognizes only supported media transport actions", () => {
    expect(isMediaTransportAction("playPause")).toBe(true);
    expect(isMediaTransportAction("next")).toBe(true);
    expect(isMediaTransportAction("previous")).toBe(true);
    expect(isMediaTransportAction("seek")).toBe(false);
  });

  it("filters and sorts only active app sessions", () => {
    const sessions = normalizeMixerSessions([
      {
        id: "b",
        appName: "Browser",
        displayName: "Browser",
        iconDataUrl: "data:image/png;base64,browser",
        volume: 0.4,
        muted: false,
        active: false,
      },
      {
        id: "a",
        appName: "Spotify",
        displayName: "Spotify",
        iconDataUrl: "data:image/png;base64,spotify",
        volume: 0.8,
        muted: false,
        active: true,
      },
      {
        id: "",
        appName: "",
        displayName: "",
        iconDataUrl: "file:///C:/app.exe",
        volume: 2,
        muted: true,
        active: true,
      },
    ]);

    expect(sessions).toEqual([
      expect.objectContaining({
        id: "a",
        appName: "Spotify",
        iconDataUrl: "data:image/png;base64,spotify",
        volume: 0.8,
      }),
    ]);
  });

  it("drops non-image icon payloads from native snapshots", () => {
    const sessions = normalizeMixerSessions([
      {
        id: "a",
        appName: "App",
        displayName: "App",
        iconDataUrl: "C:/Users/Lari/App.exe",
        volume: 0.4,
        muted: false,
        active: true,
      },
    ]);

    expect(sessions[0].iconDataUrl).toBeNull();
  });

  it("drops oversized app icon payloads from native snapshots", () => {
    const sessions = normalizeMixerSessions([
      {
        id: "a",
        appName: "App",
        displayName: "App",
        iconDataUrl: `data:image/png;base64,${"a".repeat(200_000)}`,
        volume: 0.4,
        muted: false,
        active: true,
      },
    ]);

    expect(sessions[0].iconDataUrl).toBeNull();
  });

  it("returns the recoverable unavailable message without exposing native details", () => {
    const snapshot: MediaMixerSnapshot = {
      available: false,
      message: "Controle de midia indisponivel neste Windows.",
      master: { volume: 0, muted: false },
      microphone: { available: false, muted: false },
      nowPlaying: null,
      sessions: [],
    };

    expect(mediaMixerStatusText(snapshot)).toBe(
      "Controle de midia indisponivel neste Windows.",
    );
  });
});
