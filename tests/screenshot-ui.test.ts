import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tauriLib = readFileSync(
  resolve(process.cwd(), "src-tauri/src/lib.rs"),
  "utf8",
);

describe("screenshot window behavior", () => {
  it("restores the toolbar while Windows ScreenClip is waiting for selection", () => {
    expect(tauriLib).toContain("RESTORE_AFTER_SCREENCLIP_OPEN_MS");
    expect(tauriLib).toContain("let early_restore_window = window.clone()");
    expect(tauriLib).toContain("restore_capture_window(&early_restore_window)");
    expect(tauriLib).toContain("restore_capture_window(&window)");
  });
});
