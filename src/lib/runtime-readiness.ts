export type RuntimeFeature = "recording" | "internetDownloads";

export type RuntimeAssetStatusCode =
  | "available"
  | "missing"
  | "corrupt"
  | "unsupportedPlatform";

export interface RuntimeAssetStatus {
  id: string;
  feature: RuntimeFeature;
  status: RuntimeAssetStatusCode;
  repairAvailable: boolean;
  repairUrl?: string;
  userMessage: string;
}

export interface RuntimeReadiness {
  assets: RuntimeAssetStatus[];
}

export function featureAvailable(
  readiness: RuntimeReadiness | null | undefined,
  feature: RuntimeFeature,
): boolean {
  const assets = readiness?.assets.filter((asset) => asset.feature === feature) ?? [];
  return assets.length > 0 && assets.every((asset) => asset.status === "available");
}

export function featureMessage(
  readiness: RuntimeReadiness | null | undefined,
  feature: RuntimeFeature,
  fallback: string,
): string {
  return (
    readiness?.assets.find(
      (asset) => asset.feature === feature && asset.status !== "available",
    )?.userMessage ?? fallback
  );
}

export function repairUrlForFeature(
  readiness: RuntimeReadiness | null | undefined,
  feature: RuntimeFeature,
): string | null {
  return (
    readiness?.assets.find(
      (asset) =>
        asset.feature === feature &&
        asset.status !== "available" &&
        asset.repairAvailable &&
        asset.repairUrl,
    )?.repairUrl ?? null
  );
}
