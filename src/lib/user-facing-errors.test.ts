import { describe, expect, it } from "vitest";
import { userFacingError } from "./user-facing-errors";

describe("userFacingError", () => {
  it("keeps friendly backend messages", () => {
    expect(
      userFacingError(
        "Gravacao de tela nao esta disponivel nesta instalacao.",
        "Nao foi possivel concluir a acao.",
      ),
    ).toBe("Gravacao de tela nao esta disponivel nesta instalacao.");
  });

  it("replaces technical dependency errors with the feature fallback", () => {
    expect(
      userFacingError(
        "ffmpeg saiu com status 1: os error 2",
        "Gravacao indisponivel nesta instalacao.",
      ),
    ).toBe("Gravacao indisponivel nesta instalacao.");

    expect(
      userFacingError(
        "yt-dlp exited with status 1: extractor failed",
        "Nao foi possivel baixar este link.",
      ),
    ).toBe("Nao foi possivel baixar este link.");
  });

  it("handles Error objects", () => {
    expect(
      userFacingError(
        new Error("SendInput retornou 0"),
        "Ditado do Windows nao abriu.",
      ),
    ).toBe("Ditado do Windows nao abriu.");
  });

  it("replaces screenshot and filesystem internals with friendly fallbacks", () => {
    expect(
      userFacingError(
        "xcap capture: failed to grab monitor",
        "Nao foi possivel salvar o print.",
      ),
    ).toBe("Nao foi possivel salvar o print.");

    expect(
      userFacingError("save png: access denied", "Nao foi possivel salvar o print."),
    ).toBe("Nao foi possivel salvar o print.");

    expect(
      userFacingError(
        "screenclip start: os error 2",
        "Nao foi possivel salvar o print.",
      ),
    ).toBe("Nao foi possivel salvar o print.");
  });

  it("replaces renderer and platform internals with friendly fallbacks", () => {
    expect(userFacingError("invoke failed: tauri command rejected", "Ação indisponível.")).toBe(
      "Ação indisponível.",
    );

    expect(
      userFacingError("NetworkError when attempting to fetch resource", "Tente novamente."),
    ).toBe("Tente novamente.");
  });
});
