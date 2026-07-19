import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/settings/SettingsApp.tsx"), "utf8");

describe("SettingsApp layout order", () => {
  it("keeps the settings sidebar in the expected order with About last", () => {
    const labels = ["Geral", "Atalhos", "Áudio", "Arquivos", "Sobre"];
    const positions = labels.map((label) => source.indexOf(`label: "${label}"`));

    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(source).not.toContain('label: "Typo Fire"');
  });
});
