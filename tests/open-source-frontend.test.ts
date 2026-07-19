import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  const full = resolve(process.cwd(), path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
};

const exists = (path: string) => existsSync(resolve(process.cwd(), path));
const joinPath = (...parts: string[]) => parts.join("/");

const oldDir = "com" + "mercial";
const app = read("src/App.tsx");
describe("open-source frontend", () => {
  it("renders the toolbar directly", () => {
    expect(app).not.toContain("Activation" + "Gate");
    expect(app).not.toContain("use" + "Commercial" + "Auth");
    expect(app).not.toContain("commercialState." + "licensed");
    expect(app).toContain("export default function App()");
    expect(app).toContain("<ToolbarApp />");
  });

  it("removes retired renderer modules", () => {
    for (const path of [
      joinPath("src", oldDir, "Activation" + "Gate.tsx"),
      joinPath("src", oldDir, oldDir + "-auth.ts"),
      joinPath("src", oldDir, "use" + "Commercial" + "Auth.ts"),
      joinPath("src", oldDir, oldDir + "-config.ts"),
      joinPath("src", oldDir, "launcher-" + "entitle" + "ment.ts"),
      joinPath("src", "google-backup", "supa" + "base-client.ts"),
      joinPath("src", "google-backup", "google-auth.ts"),
      joinPath("src", "google-backup", "google-backup.ts"),
      joinPath("src", "google-backup", "google-calendar.ts"),
      joinPath("src", "google-backup", "google-config.ts"),
      joinPath("src", "google-backup", "useGoogleAuth.ts"),
      joinPath("src", "settings", "sections", "SectionContaBackup.tsx"),
      joinPath("src", "lib", "snapbar-backup.ts"),
    ]) {
      expect(exists(path), `${path} should be removed`).toBe(false);
    }
  });

  it("has no Google OAuth runtime or release configuration", () => {
    const tauriConfig = read("src-tauri/tauri.conf.json");
    const cargo = read("src-tauri/Cargo.toml");
    const packageJson = read("package.json");
    expect(exists("src-tauri/src/google_oauth.rs")).toBe(false);
    expect(exists("scripts/verify-google-oauth-release.mjs")).toBe(false);
    expect(tauriConfig).not.toMatch(/google|oauth/i);
    expect(cargo).not.toMatch(/google|oauth/i);
    expect(packageJson).not.toMatch(/google-oauth|VITE_GOOGLE_CLIENT_ID/i);
  });
});
