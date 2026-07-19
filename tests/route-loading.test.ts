import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");

describe("route loading", () => {
  it("lazy-loads secondary windows instead of importing every app into the first chunk", () => {
    expect(main).toContain("React.lazy");
    expect(main).toContain("Suspense");
    for (const staticImport of [
      'import App from "./App"',
      'import LauncherApp from "./launcher/LauncherApp"',
      'import SettingsApp from "./settings/SettingsApp"',
      'import DownloadsApp from "./downloads/DownloadsApp"',
      'import MediaMixerApp from "./media-mixer/MediaMixerApp"',
      'import TypoFireApp from "./typo-fire/TypoFireApp"',
      'import NoteWindow from "./notes/NoteWindow"',
    ]) {
      expect(main).not.toContain(staticImport);
    }
  });
});
