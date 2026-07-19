import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  const full = resolve(process.cwd(), path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
};
const exists = (path: string) => existsSync(resolve(process.cwd(), path));
const joinPath = (...parts: string[]) => parts.join("/");

const main = read("src/main.tsx");
const tauriLib = read("src-tauri/src/lib.rs");
const settingsWindow = read("src-tauri/src/settings_window.rs");
const defaultCapability = read("src-tauri/capabilities/default.json");
const oldDir = "com" + "mercial";

describe("launcher removal", () => {
  it("removes retired onboarding routes and windows", () => {
    for (const path of [
      joinPath("src", "launcher", "LauncherApp.tsx"),
      joinPath("src", "launcher", "LauncherTutorial.tsx"),
      joinPath("src", "launcher", "LauncherApp.css"),
      joinPath("src", oldDir, "launcher-" + "entitle" + "ment.ts"),
    ]) {
      expect(exists(path), `${path} should be removed`).toBe(false);
    }
    expect(main).not.toContain("LauncherApp");
    expect(main).not.toContain("#/launcher");
    expect(settingsWindow).not.toContain("open_launcher_window");
    expect(settingsWindow).not.toContain("launcher_window_spec");
    expect(tauriLib).not.toContain("settings_window::open_launcher_window");
    expect(defaultCapability).not.toContain('"launcher"');
  });
});
