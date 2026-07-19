import { describe, expect, it } from "vitest";
import {
  DEFAULT_TYPO_FIRE_MATCHES,
  DEFAULT_APPEARANCE_SETTINGS,

  DEFAULT_DIAGNOSTICS_SETTINGS,
  SHORTCUT_ACTIONS,
  appearanceForPreset,

  normalizeAppearanceSettings,
  normalizeDiagnosticsSettings,
  normalizeBehaviorSettings,
  normalizeOutputPaths,
  normalizeTypoFireMatches,
  normalizeTypoFireSettings,
} from "./app-settings";

describe("behavior settings", () => {
  it("defaults toolbar sizing to compact and orientation to horizontal for new and legacy settings", () => {
    expect(normalizeBehaviorSettings({})).toMatchObject({
      toolbarSizeMode: "compact",
      toolbarOrientation: "horizontal",
    });
    expect(
      normalizeBehaviorSettings({
        alwaysOnTop: false,
        inactiveOpacity: 75,
        autoHide: true,
      }),
    ).toEqual({
      alwaysOnTop: false,
      inactiveOpacity: 75,
      autoHide: true,
      toolbarSizeMode: "compact",
      toolbarOrientation: "horizontal",
    });
  });

  it("keeps supported toolbar size modes and rejects invalid ones", () => {
    expect(normalizeBehaviorSettings({ toolbarSizeMode: "compact" })).toMatchObject({
      toolbarSizeMode: "compact",
    });
    expect(normalizeBehaviorSettings({ toolbarSizeMode: "mini" })).toMatchObject({
      toolbarSizeMode: "mini",
    });
    expect(
      normalizeBehaviorSettings({ toolbarSizeMode: "huge" } as never),
    ).toMatchObject({
      toolbarSizeMode: "compact",
    });
  });

  it("keeps supported toolbar orientations and rejects invalid ones", () => {
    expect(normalizeBehaviorSettings({ toolbarOrientation: "horizontal" })).toMatchObject({
      toolbarOrientation: "horizontal",
    });
    expect(normalizeBehaviorSettings({ toolbarOrientation: "vertical" })).toMatchObject({
      toolbarOrientation: "vertical",
    });
    expect(
      normalizeBehaviorSettings({ toolbarOrientation: "diagonal" } as never),
    ).toMatchObject({
      toolbarOrientation: "horizontal",
    });
  });

  it("clamps opacity values entered from the settings number field", () => {
    expect(normalizeBehaviorSettings({ inactiveOpacity: 4 })).toMatchObject({
      inactiveOpacity: 10,
    });
    expect(normalizeBehaviorSettings({ inactiveOpacity: 108 })).toMatchObject({
      inactiveOpacity: 100,
    });
  });

  it("rounds opacity to five-point steps for predictable controls", () => {
    expect(normalizeBehaviorSettings({ inactiveOpacity: 37 })).toMatchObject({
      inactiveOpacity: 35,
    });
    expect(normalizeBehaviorSettings({ inactiveOpacity: 38 })).toMatchObject({
      inactiveOpacity: 40,
    });
  });
});

describe("output path settings", () => {
  it("describes screenshot capture as the native Windows snip flow", () => {
    expect(SHORTCUT_ACTIONS.find((action) => action.id === "capture")).toMatchObject({
      hint: "Abre o recorte do Windows",
    });
  });

  it("keeps configured screenshot and recording folders", () => {
    expect(
      normalizeOutputPaths({
        screenshotDir: "D:\\Snapbar\\Prints",
        recordingDir: "D:\\Snapbar\\Videos",
        internetDownloadDir: "D:\\Snapbar\\Downloads",
      }),
    ).toEqual({
      screenshotDir: "D:\\Snapbar\\Prints",
      recordingDir: "D:\\Snapbar\\Videos",
      internetDownloadDir: "D:\\Snapbar\\Downloads",
    });
  });

  it("drops empty folder values so defaults are used", () => {
    expect(
      normalizeOutputPaths({
        screenshotDir: "  ",
        recordingDir: "",
        internetDownloadDir: " ",
      }),
    ).toEqual({});
  });
});

describe("diagnostics settings", () => {
  it("keeps detailed logs disabled by default", () => {
    expect(DEFAULT_DIAGNOSTICS_SETTINGS).toEqual({ detailedLogs: false });
    expect(normalizeDiagnosticsSettings({})).toEqual({ detailedLogs: false });
  });

  it("allows an explicit local opt-in for detailed logs", () => {
    expect(normalizeDiagnosticsSettings({ detailedLogs: true })).toEqual({
      detailedLogs: true,
    });
    expect(
      normalizeDiagnosticsSettings({ detailedLogs: "yes" } as never),
    ).toEqual({ detailedLogs: false });
  });
});


describe("appearance settings", () => {
  it("defaults Snapbar to the current visual with the Donut toolbar", () => {
    expect(DEFAULT_APPEARANCE_SETTINGS).toMatchObject({
      preset: "default",
      toolbarShape: "donutLegacy",
      glassIntensity: "medium",
      wallpaper: {
        enabled: false,
        path: "",
      },
    });
    expect(normalizeAppearanceSettings({})).toEqual(DEFAULT_APPEARANCE_SETTINGS);
  });

  it("keeps visual choices to Padrão and Liquid Glass", () => {
    const defaultPreset = appearanceForPreset("default");
    const liquidGlass = appearanceForPreset("liquidGlass");
    expect(defaultPreset).toMatchObject({
      preset: "default",
      toolbarShape: "donutLegacy",
    });
    expect(liquidGlass).toMatchObject({
      preset: "liquidGlass",
      toolbarShape: "donutLegacy",
      glassIntensity: "medium",
      glass: {
        blur: 30,
      },
    });
  });

  it("migrates removed appearance presets back to Padrão without losing manual values", () => {
    expect(
      normalizeAppearanceSettings({
        preset: "legacy",
        accentColor: "#123456",
        toolbarShape: "dock",
      }),
    ).toMatchObject({
      preset: "default",
      accentColor: "#123456",
      toolbarShape: "donutLegacy",
    });
    expect(
      normalizeAppearanceSettings({
        preset: "custom",
        glass: { blur: 12 },
      }),
    ).toMatchObject({
      preset: "default",
      glass: { blur: 12 },
    });
    expect(normalizeAppearanceSettings({ preset: "cleanCorpDark" })).toMatchObject({
      preset: "default",
    });
  });

  it("normalizes manual values without accepting unsafe ranges", () => {
    expect(
      normalizeAppearanceSettings({
        preset: "unknown",
        toolbarShape: "bad",
        accentColor: "javascript:alert(1)",
        glass: {
          blur: 999,
          opacity: 2,
          radius: -20,
          shadow: 999,
        },
        wallpaper: {
          enabled: true,
          path: " C:\\Users\\Lari\\Pictures\\wall.png ",
          dim: 999,
          blur: -2,
        },
        motion: {
          enabled: false,
          speed: 2,
          stagger: 999,
          morph: -8,
        },
      }),
    ).toMatchObject({
      preset: "default",
      toolbarShape: "donutLegacy",
      accentColor: DEFAULT_APPEARANCE_SETTINGS.accentColor,
      glassIntensity: "medium",
      glass: {
        blur: 80,
        opacity: 20,
        radius: 4,
        shadow: 100,
      },
      wallpaper: {
        enabled: true,
        path: "C:\\Users\\Lari\\Pictures\\wall.png",
        dim: 85,
        blur: 0,
      },
      motion: {
        enabled: false,
        speed: 50,
        stagger: 140,
        morph: 0,
      },
    });
  });
});

describe("Windows voice typing shortcuts", () => {
  it("keeps speech-to-text as a global shortcut action without local speech settings", () => {
    expect(SHORTCUT_ACTIONS).toContainEqual(
      expect.objectContaining({
        id: "toggle_dictation",
        label: "Digitação por voz",
        hint: "Aciona o Win+H do Windows",
      }),
    );
  });
});

describe("productivity shortcuts", () => {
  it("keeps Todo Calendar and Pomodoro available only as shortcut actions and tools", () => {
    expect(SHORTCUT_ACTIONS.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        "open_todo_calendar",
        "open_pomodoro",
        "pomodoro_start_pause",
        "quick_add_todo",
      ]),
    );
    expect(SHORTCUT_ACTIONS.map((action) => action.id)).not.toContain(
      "quick_add_reminder",
    );
  });
});

describe("Typo Fire settings", () => {
  it("starts with a Text Blaze style slash snippet example", () => {
    expect(DEFAULT_TYPO_FIRE_MATCHES).toEqual([
      expect.objectContaining({
        label: "Oi",
        triggers: ["/oi"],
        replace: "ola tudo bem com vc? ",
        matchType: "literal",
        enabled: true,
      }),
    ]);
  });

  it("adds Typo Fire actions to the global shortcut catalog", () => {
    expect(SHORTCUT_ACTIONS.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        "typo_fire_toggle",
        "typo_fire_search",
        "typo_fire_reload",
      ]),
    );
  });

  it("adds media mixer actions to the global shortcut catalog", () => {
    expect(SHORTCUT_ACTIONS.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        "open_mixer",
        "media_play_pause",
        "media_next",
        "media_previous",
        "media_mute",
      ]),
    );
  });

  it("normalizes Typo Fire settings with safe defaults", () => {
    expect(
      normalizeTypoFireSettings({
        enabled: true,
        prefix: " // ",
        triggerMode: "bad",
        backend: "clipboard",
        undoBackspace: true,
        appFilters: {
          mode: "include",
          entries: [" notepad.exe ", "", "Code.exe"],
        },
      }),
    ).toEqual({
      enabled: true,
      prefix: "/",
      triggerMode: "suffix",
      backend: "clipboard",
      searchShortcut: "",
      toggleShortcut: "",
      undoBackspace: true,
      allowScripts: false,
      appFilters: {
        mode: "include",
        entries: ["notepad.exe", "Code.exe"],
      },
    });
  });

  it("deduplicates Typo Fire app filter entries after trimming", () => {
    expect(
      normalizeTypoFireSettings({
        appFilters: {
          mode: "exclude",
          entries: [" Code.exe ", "notepad.exe", "Code.exe", "  "],
        },
      }).appFilters,
    ).toEqual({
      mode: "exclude",
      entries: ["Code.exe", "notepad.exe"],
    });
  });

  it("keeps slash as the default Typo Fire prefix and allows changing it", () => {
    expect(normalizeTypoFireSettings({})).toMatchObject({ prefix: "/" });
    expect(normalizeTypoFireSettings({ prefix: ";" })).toMatchObject({
      prefix: ";",
    });
    expect(normalizeTypoFireSettings({ prefix: "ó/" })).toMatchObject({
      prefix: "/",
    });
    expect(normalizeTypoFireSettings({ prefix: "abc" })).toMatchObject({
      prefix: "a",
    });
  });

  it("normalizes Typo Fire matches and removes invalid rows", () => {
    expect(
      normalizeTypoFireMatches([
        {
          id: "  ",
          label: "Email",
          triggers: [":email", ""],
          replace: "hello@example.com",
          matchType: "literal",
          enabled: true,
        },
        {
          id: "bad",
          label: "Sem trigger",
          triggers: [],
          replace: "x",
          matchType: "literal",
          enabled: true,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        label: "Email",
        triggers: [":email"],
        replace: "hello@example.com",
        matchType: "literal",
        enabled: true,
      }),
    ]);
  });

  it("deduplicates Typo Fire match triggers after trimming", () => {
    expect(
      normalizeTypoFireMatches([
        {
          label: "Email",
          triggers: [":email", " :email ", ":mail"],
          replace: "hello@example.com",
          matchType: "literal",
          enabled: true,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        triggers: [":email", ":mail"],
      }),
    ]);
  });
});
