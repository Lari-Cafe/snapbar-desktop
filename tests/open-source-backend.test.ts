import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const exists = (path: string) => existsSync(resolve(process.cwd(), path));
const joinPath = (...parts: string[]) => parts.join("/");

const oldDir = "com" + "mercial";

describe("open-source backend surface", () => {
  it("removes retired server code and backend project files", () => {
    for (const path of [
      "supa" + "base",
      joinPath("src-tauri", "src", "lic" + "ense.rs"),
      joinPath("scripts", "generate-" + "license-keys.ps1"),
      joinPath("scripts", "configure-supa" + "base-secrets-interactive.ps1"),
      joinPath("scripts", "set-supa" + "base-secrets.ps1"),
      joinPath("scripts", "verify-supa" + "base-" + oldDir + "-functions.ps1"),
    ]) {
      expect(exists(path), `${path} should be removed`).toBe(false);
    }
  });
});
