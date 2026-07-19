import { describe, expect, it } from "vitest";
import {
  featureAvailable,
  featureMessage,
  repairUrlForFeature,
  type RuntimeReadiness,
} from "./runtime-readiness";

const ready: RuntimeReadiness = {
  assets: [
    {
      id: "ffmpeg",
      feature: "recording",
      status: "available",
      repairAvailable: false,
      userMessage: "Gravacao pronta.",
    },
    {
      id: "yt-dlp",
      feature: "internetDownloads",
      status: "available",
      repairAvailable: false,
      userMessage: "Downloads pronto.",
    },
  ],
};

describe("runtime readiness", () => {
  it("reports a feature as available only when all of its assets are available", () => {
    expect(featureAvailable(ready, "recording")).toBe(true);
    expect(featureAvailable(ready, "internetDownloads")).toBe(true);

    expect(
      featureAvailable(
        {
          assets: [
            ...ready.assets,
            {
              id: "ffmpeg",
              feature: "recording",
              status: "missing",
              repairAvailable: true,
              repairUrl: "https://example.test/repair",
              userMessage: "Gravacao indisponivel nesta instalacao.",
            },
          ],
        },
        "recording",
      ),
    ).toBe(false);
  });

  it("returns the first friendly message for an unavailable feature", () => {
    expect(
      featureMessage(
        {
          assets: [
            {
              id: "ffmpeg",
              feature: "recording",
              status: "corrupt",
              repairAvailable: true,
              userMessage: "Gravacao indisponivel nesta instalacao.",
            },
          ],
        },
        "recording",
        "Recurso indisponivel.",
      ),
    ).toBe("Gravacao indisponivel nesta instalacao.");
  });

  it("reports internet downloads unavailable when yt-dlp is missing", () => {
    expect(
      featureMessage(
        {
          assets: [
            {
              id: "yt-dlp",
              feature: "internetDownloads",
              status: "missing",
              repairAvailable: true,
              userMessage: "Downloads indisponiveis nesta instalacao.",
            },
          ],
        },
        "internetDownloads",
        "Downloads indisponiveis nesta instalacao.",
      ),
    ).toBe("Downloads indisponiveis nesta instalacao.");
  });

  it("returns a repair URL only for unavailable assets that can be repaired online", () => {
    expect(
      repairUrlForFeature(
        {
          assets: [
            {
              id: "ffmpeg",
              feature: "recording",
              status: "missing",
              repairAvailable: true,
              repairUrl: "https://example.test/repair",
              userMessage: "Gravacao indisponivel nesta instalacao.",
            },
          ],
        },
        "recording",
      ),
    ).toBe("https://example.test/repair");
  });
});
