import { describe, expect, it } from "vitest";
import {
  applyInternetDownloadEvent,
  bestSelectableVideoQuality,
  canAnalyzeDownloadUrl,
  internetDownloadStatusText,
  normalizeInternetDownloadOptions,
  upsertInternetDownloadEvent,
  type InternetDownloadJob,
} from "./internet-downloads";

describe("internet downloads", () => {
  it("uses MP4 1080p video with balanced MP3 quality as the default", () => {
    expect(normalizeInternetDownloadOptions({})).toEqual({
      format: "mp4",
      videoQuality: "1080p",
      audioQualityKbps: 192,
      outputDir: undefined,
    });
  });

  it("only analyzes public http and https URLs", () => {
    expect(canAnalyzeDownloadUrl(" https://www.youtube.com/watch?v=abc ")).toBe(true);
    expect(canAnalyzeDownloadUrl("http://example.com/video")).toBe(true);
    expect(canAnalyzeDownloadUrl("file:///C:/Users/Lari/video.mp4")).toBe(false);
    expect(canAnalyzeDownloadUrl("javascript:alert(1)")).toBe(false);
  });

  it("updates the session queue from backend progress events", () => {
    const queued: InternetDownloadJob = {
      id: "job-1",
      url: "https://example.com/video",
      title: "Video",
      status: "queued",
      progressPercent: 0,
      speed: "",
      stage: "Na fila",
    };

    const next = applyInternetDownloadEvent([queued], {
      id: "job-1",
      status: "downloading",
      progressPercent: 42.5,
      speed: "1.8MiB/s",
      stage: "Baixando",
    });

    expect(next).toEqual([
      {
        ...queued,
        status: "downloading",
        progressPercent: 42.5,
        speed: "1.8MiB/s",
        stage: "Baixando",
      },
    ]);
  });

  it("upserts repeated backend events instead of duplicating queue rows", () => {
    const started = {
      id: "job-1",
      url: "https://example.com/video",
      title: "Video",
      status: "downloading" as const,
      progressPercent: 0,
      stage: "Baixando",
    };

    const once = upsertInternetDownloadEvent([], started, started.url);
    const twice = upsertInternetDownloadEvent(
      once,
      { ...started, progressPercent: 100, status: "completed" },
      started.url,
    );

    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({
      id: "job-1",
      status: "completed",
      progressPercent: 100,
    });
  });

  it("picks the best visible video quality without exposing Auto", () => {
    expect(bestSelectableVideoQuality(["auto", "720p", "480p"])).toBe("720p");
    expect(bestSelectableVideoQuality(["auto"])).toBe("1080p");
  });

  it("shows the compact saved path message when a download completes", () => {
    expect(
      internetDownloadStatusText({
        status: "completed",
        outputPath: "C:\\Users\\Lari\\Downloads\\video.mp4",
      }),
    ).toBe("Salvo em: C:\\Users\\Lari\\Downloads\\video.mp4");
  });
});
