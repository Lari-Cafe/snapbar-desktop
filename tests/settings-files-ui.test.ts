import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const filesSection = read("src/settings/sections/SectionArquivos.tsx");

describe("settings files section", () => {
  it("does not load the native folder dialog on section mount", () => {
    expect(filesSection).not.toContain('import { open } from "@tauri-apps/plugin-dialog"');
    expect(filesSection).toContain('await import("@tauri-apps/plugin-dialog")');
  });

  it("guards folder picking so repeated clicks cannot stack dialogs", () => {
    expect(filesSection).toContain("choosingKey");
    expect(filesSection).toContain("disabled={choosingKey !== null}");
  });
});
