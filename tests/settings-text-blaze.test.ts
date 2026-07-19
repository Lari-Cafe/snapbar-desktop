import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/settings/sections/SectionTypoFire.tsx"),
  "utf8",
);

describe("Typo Fire Text Blaze style UX", () => {
  it("teaches slash snippets with the /oi example", () => {
    expect(source).toContain("/oi");
    expect(source).toContain("olá, tudo bem?");
    expect(source).toContain("Snippets");
  });

  it("shows saved snippets in a wrapping preset shelf that can be edited", () => {
    expect(source).toContain("typo-fire-preset-bar");
    expect(source).toContain("presetTextPreview(match.replace)");
    expect(source).toContain("Preset salvo");
    expect(source).toContain("Editar snippet");
    expect(source).not.toContain("presetsExpanded");
    expect(source).not.toContain("Mostrar mais");
  });

  it("keeps saved snippets synced when another window saves Typo Fire data", () => {
    expect(source).toContain("listen<TypoFireChangedPayload>");
    expect(source).toContain('"settings://changed"');
    expect(source).toContain("setMatches(next.matches)");
  });

  it("uses clear user-facing labels for creating snippets", () => {
    expect(source).not.toContain("Nome do preset");
    expect(source).toContain("Atalho que você digita");
    expect(source).toContain("Texto que aparece");
    expect(source).toContain("Vai salvar como");
    expect(source).toContain("placeholder=\"oi\"");
    expect(source).toContain("Avançado");
  });

  it("explains advanced Regex and YAML without putting Regex in the main form", () => {
    expect(source).toContain("Regex é para padrões avançados");
    expect(source).toContain("YAML é um formato de texto para importar ou exportar seus presets");
    expect(source).toContain("Tipo de preset");
    expect(source).not.toContain("aria-label=\"Tipo de snippet\"");
  });

  it("lets the user change the slash prefix without showing the live popup inside settings", () => {
    expect(source).toContain("Prefixo do Typo Fire");
    expect(source).toContain("prefixOptions");
    expect(source).toContain("sanitizePrefix");
    expect(source).toContain("Escolha um prefixo");
    expect(source).not.toContain("typo-fire-live-preview");
    expect(source).not.toContain("previewMatches");
    expect(source).not.toContain("a preview mostra");
    expect(source).not.toContain("typo-fire-prefix-input");
  });

  it("uses clear edit/status controls instead of repeated checkmark buttons", () => {
    expect(source).toContain("Pencil");
    expect(source).toContain("Star");
    expect(source).toContain("Favorito");
    expect(source).toContain("Ativo");
    expect(source).not.toContain("Check");
    expect(source).not.toContain("Texto simples</span>");
  });

  it("keeps internal hook diagnostics out of the user interface", () => {
    expect(source).toContain("keystrokesSeen");
    expect(source).toContain("lastActivityAt");
    expect(source).not.toContain("Hook global ativo");
    expect(source).not.toContain("Teclas ouvidas");
    expect(source).not.toContain("Ultima atividade");
    expect(source).not.toContain("typedText");
  });
});
