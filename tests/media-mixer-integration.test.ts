import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readProjectFile(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("media mixer integration", () => {
  it("registers the dedicated route and React app", () => {
    const main = readProjectFile("src/main.tsx");

    expect(main).toContain("#/media-mixer");
    expect(main).toContain("MediaMixerApp");
  });

  it("adds the Mixer button while keeping shortcuts in settings only", () => {
    const app = readProjectFile("src/App.tsx");
    const toolbarActions = readProjectFile("src/lib/toolbar-actions.ts");
    const settings = readProjectFile("src/settings/SettingsApp.tsx");

    expect(toolbarActions).toContain('id: "mixer"');
    expect(toolbarActions).not.toContain('id: "shortcut"');
    expect(app).toContain("open_media_mixer_window");
    expect(settings).toContain("SectionAtalhos");
  });

  it("exposes native media mixer commands to Tauri", () => {
    const lib = readProjectFile("src-tauri/src/lib.rs");

    expect(lib).toContain("mod media_mixer;");
    expect(lib).toContain("media_mixer::open_media_mixer_window");
    expect(lib).toContain("media_mixer::media_mixer_snapshot");
    expect(lib).toContain("media_mixer::media_mixer_transport");
    expect(lib).toContain("media_mixer::media_mixer_set_master_volume");
    expect(lib).toContain("media_mixer::media_mixer_set_microphone_muted");
    expect(lib).toContain("media_mixer::media_mixer_set_session_muted");
  });

  it("allows the media mixer window under the desktop capability", () => {
    const capability = readProjectFile("src-tauri/capabilities/default.json");

    expect(capability).toContain('"media-mixer"');
  });
});
