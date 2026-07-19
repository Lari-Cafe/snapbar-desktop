interface InstallerManifest {
  version?: string;
  channel?: string;
  publishedAt?: string;
  windowsX64?: {
    fileName?: string;
    url?: string;
    sha256?: string;
    sizeBytes?: number;
  };
}

const manifestUrl = import.meta.env.VITE_SNAPBAR_INSTALLER_MANIFEST_URL ?? "";
const titleEl = document.getElementById("installerTitle");
const statusEl = document.getElementById("installerStatus");
const metaEl = document.getElementById("installerMeta");
const checksumEl = document.getElementById("installerChecksum");
const downloadEl = document.getElementById("installerDownload") as HTMLAnchorElement | null;

function setStatus(message: string) {
  if (statusEl) statusEl.textContent = message;
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return "tamanho não informado";
  const mb = value / 1024 / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function disableDownload() {
  downloadEl?.removeAttribute("href");
  downloadEl?.setAttribute("aria-disabled", "true");
}

async function loadManifest() {
  if (!manifestUrl) {
    disableDownload();
    setStatus("Manifesto ainda não configurado. Publique latest.json junto com o build.");
    return;
  }

  try {
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("manifest");
    const manifest = (await response.json()) as InstallerManifest;
    const installer = manifest.windowsX64;
    if (!installer?.url) throw new Error("installer");

    if (titleEl) titleEl.textContent = installer.fileName ?? "Instalador do Snapbar";
    if (metaEl) metaEl.textContent = `Versão ${manifest.version ?? "sem versão"} - ${formatBytes(installer.sizeBytes)}`;
    if (checksumEl && installer.sha256) {
      checksumEl.hidden = false;
      checksumEl.textContent = `SHA-256: ${installer.sha256}`;
    }
    if (downloadEl) {
      downloadEl.href = installer.url;
      downloadEl.setAttribute("aria-disabled", "false");
    }
    setStatus("Download pronto.");
  } catch {
    disableDownload();
    setStatus("Não foi possível carregar o instalador agora. Tente novamente em instantes.");
  }
}

void loadManifest();
