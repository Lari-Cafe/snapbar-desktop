import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import defaultCapability from "../../src-tauri/capabilities/default.json";
import typoFirePopupCapability from "../../src-tauri/capabilities/typo-fire-popup.json";
import runtimeAssets from "../../src-tauri/runtime-assets.json";
import tauriConfig from "../../src-tauri/tauri.conf.json";

function bundleResourceSources(): string[] {
  const resources = tauriConfig.bundle.resources;
  return Array.isArray(resources) ? resources : Object.keys(resources);
}

function bundleResourceTargets(): string[] {
  const resources = tauriConfig.bundle.resources;
  return Array.isArray(resources) ? resources : Object.values(resources);
}

describe("Tauri window config", () => {
  it("keeps the main toolbar window focusable for mouse interactions", () => {
    const mainWindow = tauriConfig.app.windows.find(
      (window) => window.label === "main",
    );

    expect(mainWindow?.focus).not.toBe(false);
  });

  it("blocks native resize so Windows cannot crop the Snapbar surface", () => {
    const mainWindow = tauriConfig.app.windows.find(
      (window) => window.label === "main",
    );

    expect(mainWindow?.resizable).toBe(false);
  });

  it("keeps the main toolbar webview background fully transparent", () => {
    const mainWindow = tauriConfig.app.windows.find(
      (window) => window.label === "main",
    );

    expect(mainWindow?.transparent).toBe(true);
    expect(mainWindow?.backgroundColor).toBe("#00000000");
    expect(mainWindow?.shadow).toBe(false);
  });

  it("starts the packaged toolbar at the compact floating horizontal size", () => {
    const mainWindow = tauriConfig.app.windows.find(
      (window) => window.label === "main",
    );

    expect(mainWindow?.width).toBe(760);
    expect(mainWindow?.height).toBe(86);
    expect(mainWindow?.minWidth).toBeLessThanOrEqual(86);
    expect(mainWindow?.minHeight).toBeLessThanOrEqual(86);
    expect(mainWindow?.maxWidth).toBeGreaterThanOrEqual(760);
    expect(mainWindow?.maxHeight).toBeGreaterThanOrEqual(760);
  });

  it("prepares runtime assets before building the installer", () => {
    const beforeBuildCommand = tauriConfig.build.beforeBuildCommand;

    expect(beforeBuildCommand).toContain("npm run assets:prepare");
    expect(beforeBuildCommand.indexOf("npm run assets:prepare")).toBeLessThan(
      beforeBuildCommand.indexOf("npm run build"),
    );
  });

  it("packages without retired Google OAuth configuration", () => {
    expect("google-oauth:verify" in packageJson.scripts).toBe(false);
    expect(tauriConfig.build.beforeBuildCommand).not.toMatch(/google|oauth/i);
  });

  it("verifies runtime assets before the Tauri bundler creates installers", () => {
    expect(tauriConfig.build.beforeBundleCommand).toContain(
      "npm run assets:verify",
    );
  });

  it("keeps the generated full-bleed hand Windows icon set", () => {
    expect(tauriConfig.bundle.icon).toEqual(
      expect.arrayContaining([
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.ico",
      ]),
    );
  });

  it("bundles only mandatory runtime assets in the base installer", () => {
    expect(bundleResourceSources()).toEqual(
      expect.arrayContaining([
        "resources/bin/*",
      ]),
    );
    expect(bundleResourceTargets()).toEqual(
      expect.arrayContaining([
        "bin/",
      ]),
    );
    expect(bundleResourceSources().some((source) => source.includes("speech"))).toBe(false);
    expect(bundleResourceTargets().some((target) => target.includes("speech"))).toBe(false);
  });

  it("uses a current-user NSIS installer with cleanup hooks", () => {
    expect(tauriConfig.bundle.windows?.nsis?.installMode).toBe("currentUser");
    expect(tauriConfig.bundle.windows?.nsis?.installerHooks).toBe("installer-hooks.nsh");
    expect(tauriConfig.bundle.windows?.webviewInstallMode).toEqual({
      type: "offlineInstaller",
      silent: true,
    });
  });

  it("keeps speech models out of all base runtime manifests", () => {
    expect(runtimeAssets.assets.some((asset) => asset.feature === "speech")).toBe(false);
    expect(runtimeAssets.assets.some((asset) => asset.packagePath.includes("speech"))).toBe(false);
  });

  it("keeps every runtime manifest asset covered by Tauri bundle resources", () => {
    const resourceGlobs = new Set(bundleResourceSources());

    for (const asset of runtimeAssets.assets) {
      const folder = asset.packagePath.replace(/\/[^/]+$/, "/*");

      expect(resourceGlobs.has(folder)).toBe(true);
    }
  });

  it("bundles the JavaScript runtime used by internet downloads", () => {
    expect(runtimeAssets.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "deno",
          feature: "internetDownloads",
          packagePath: "resources/bin/deno.exe",
        }),
      ]),
    );
  });

  it("keeps the Typo Fire popup on a minimal dedicated capability", () => {
    expect(defaultCapability.windows).not.toContain("typo-fire-popup");
    expect(typoFirePopupCapability.windows).toEqual(["typo-fire-popup"]);
    expect(typoFirePopupCapability.permissions).toEqual([
      "core:default",
      "core:event:allow-listen",
      "core:event:allow-unlisten",
    ]);
  });

  it("allows productivity and Typo Fire tool windows in the desktop capability", () => {
    expect(defaultCapability.windows).toEqual(
      expect.arrayContaining([
        "todo-calendar",
        "pomodoro",
        "productivity-alert",
        "typo-fire",
      ]),
    );
    expect(defaultCapability.permissions).toEqual(
      expect.arrayContaining([
        "notification:default",
        "core:window:allow-set-min-size",
        "core:window:allow-set-resizable",
        "core:window:allow-unminimize",
      ]),
    );
  });

  it("exposes a package command that builds and verifies the installer assets", () => {
    expect(packageJson.scripts.package).toContain("npm run tauri build");
    expect(packageJson.scripts.package).toContain(
      "npm run assets:verify-package",
    );
    expect(packageJson.scripts["assets:verify"]).toContain(
      "scripts/verify-runtime-assets.ps1",
    );
    expect(packageJson.scripts["assets:verify-package"]).toContain(
      "scripts/verify-runtime-assets.ps1",
    );
    expect(Object.keys(packageJson.scripts).some((script) => script.includes("speech-assets"))).toBe(false);
    expect(packageJson.scripts.package).not.toContain("speech-assets");
  });
});
