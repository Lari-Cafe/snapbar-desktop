use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use tauri::{AppHandle, Manager};

const RUNTIME_ASSET_MANIFEST: &str = include_str!("../runtime-assets.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeAssetManifest {
    assets: Vec<RuntimeAssetDefinition>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeAssetDefinition {
    id: String,
    feature: RuntimeFeature,
    display_name: String,
    platform: String,
    runtime_path: String,
    package_path: String,
    version: String,
    license: String,
    source: String,
    sha256: String,
    repair_url: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeFeature {
    Recording,
    InternetDownloads,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeAssetStatusCode {
    Available,
    Missing,
    Corrupt,
    UnsupportedPlatform,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAssetStatus {
    pub id: String,
    pub feature: RuntimeFeature,
    pub status: RuntimeAssetStatusCode,
    pub repair_available: bool,
    pub repair_url: Option<String>,
    pub user_message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadiness {
    pub assets: Vec<RuntimeAssetStatus>,
}

#[tauri::command]
pub fn runtime_readiness(app: AppHandle) -> Result<RuntimeReadiness, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| "Nao foi possivel verificar os recursos instalados.".to_string())?;
    readiness_for_manifest_in_dir(&resource_dir, RUNTIME_ASSET_MANIFEST)
}

pub fn ensure_feature_available(app: &AppHandle, feature: RuntimeFeature) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| feature_unavailable_message(feature, false))?;
    let readiness = readiness_for_manifest_in_dir(&resource_dir, RUNTIME_ASSET_MANIFEST)?;
    if readiness
        .assets
        .iter()
        .filter(|asset| asset.feature == feature)
        .all(|asset| asset.status == RuntimeAssetStatusCode::Available)
    {
        Ok(())
    } else {
        Err(readiness
            .assets
            .iter()
            .find(|asset| {
                asset.feature == feature && asset.status != RuntimeAssetStatusCode::Available
            })
            .map(|asset| asset.user_message.clone())
            .unwrap_or_else(|| feature_unavailable_message(feature, false)))
    }
}

fn readiness_for_manifest_in_dir(
    resource_dir: &Path,
    manifest_text: &str,
) -> Result<RuntimeReadiness, String> {
    let manifest: RuntimeAssetManifest = serde_json::from_str(manifest_text)
        .map_err(|_| "Nao foi possivel verificar os recursos instalados.".to_string())?;

    Ok(RuntimeReadiness {
        assets: manifest
            .assets
            .iter()
            .map(|asset| asset_status(resource_dir, asset))
            .collect(),
    })
}

fn asset_status(resource_dir: &Path, asset: &RuntimeAssetDefinition) -> RuntimeAssetStatus {
    let repair_available = asset
        .repair_url
        .as_deref()
        .map(|value| value.starts_with("https://"))
        .unwrap_or(false);
    let status = if asset.platform != current_platform() {
        RuntimeAssetStatusCode::UnsupportedPlatform
    } else {
        let path = runtime_asset_path(resource_dir, &asset.runtime_path);
        if path.is_none() {
            RuntimeAssetStatusCode::Missing
        } else if !is_sha256(&asset.sha256)
            || sha256_file(path.as_deref().unwrap()).ok().as_deref() != Some(asset.sha256.as_str())
        {
            RuntimeAssetStatusCode::Corrupt
        } else {
            RuntimeAssetStatusCode::Available
        }
    };

    RuntimeAssetStatus {
        id: asset.id.clone(),
        feature: asset.feature,
        status: status.clone(),
        repair_available,
        repair_url: asset
            .repair_url
            .clone()
            .filter(|value| value.starts_with("https://")),
        user_message: match status {
            RuntimeAssetStatusCode::Available => format!("{} pronto.", asset.display_name),
            RuntimeAssetStatusCode::Missing
            | RuntimeAssetStatusCode::Corrupt
            | RuntimeAssetStatusCode::UnsupportedPlatform => {
                feature_unavailable_message(asset.feature, repair_available)
            }
        },
    }
}

fn runtime_asset_path(resource_dir: &Path, runtime_path: &str) -> Option<std::path::PathBuf> {
    [
        resource_dir.join(runtime_path),
        resource_dir.join("resources").join(runtime_path),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn feature_unavailable_message(feature: RuntimeFeature, repair_available: bool) -> String {
    let base = match feature {
        RuntimeFeature::Recording => "Gravacao indisponivel nesta instalacao.",
        RuntimeFeature::InternetDownloads => "Downloads indisponiveis nesta instalacao.",
    };
    if repair_available {
        format!("{base} Use o reparo online ou reinstale o Snapbar.")
    } else {
        format!("{base} Reinstale ou atualize o Snapbar.")
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|_| "arquivo indisponivel".to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn current_platform() -> &'static str {
    if cfg!(all(windows, target_arch = "x86_64")) {
        "windows-x64"
    } else if cfg!(all(windows, target_arch = "aarch64")) {
        "windows-arm64"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unsupported"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("snapbar-runtime-assets-{name}-{nanos}"))
    }

    #[test]
    fn marks_assets_available_when_present_and_checksum_matches() {
        let dir = unique_temp_dir("available");
        let bin_dir = dir.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("ffmpeg.exe"), b"binary").unwrap();
        let manifest = r#"
        {
          "assets": [
            {
              "id": "ffmpeg",
              "feature": "recording",
              "displayName": "Gravacao de tela",
              "platform": "windows-x64",
              "runtimePath": "bin/ffmpeg.exe",
              "packagePath": "resources/bin/ffmpeg.exe",
              "version": "test",
              "license": "test",
              "source": "test",
              "sha256": "9a3a45d01531a20e89ac6ae10b0b0beb0492acd7216a368aa062d1a5fecaf9cd",
              "repairUrl": "https://example.test/ffmpeg.exe"
            }
          ]
        }
        "#;

        let readiness = readiness_for_manifest_in_dir(&dir, manifest).unwrap();

        assert_eq!(
            readiness.assets[0].status,
            RuntimeAssetStatusCode::Available
        );
        assert!(readiness.assets[0].repair_available);
        assert_eq!(
            readiness.assets[0].repair_url.as_deref(),
            Some("https://example.test/ffmpeg.exe")
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn marks_assets_corrupt_when_checksum_does_not_match() {
        let dir = unique_temp_dir("corrupt");
        let bin_dir = dir.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("ffmpeg.exe"), b"changed").unwrap();
        let manifest = r#"
        {
          "assets": [
            {
              "id": "ffmpeg",
              "feature": "recording",
              "displayName": "Gravacao de tela",
              "platform": "windows-x64",
              "runtimePath": "bin/ffmpeg.exe",
              "packagePath": "resources/bin/ffmpeg.exe",
              "version": "test",
              "license": "test",
              "source": "test",
              "sha256": "9a3a45d01531a20e89ac6ae10b0b0beb0492acd7216a368aa062d1a5fecaf9cd",
              "repairUrl": "https://example.test/ffmpeg.exe"
            }
          ]
        }
        "#;

        let readiness = readiness_for_manifest_in_dir(&dir, manifest).unwrap();

        assert_eq!(readiness.assets[0].status, RuntimeAssetStatusCode::Corrupt);
        assert_eq!(
            readiness.assets[0].user_message,
            "Gravacao indisponivel nesta instalacao. Use o reparo online ou reinstale o Snapbar."
        );
        assert!(!readiness.assets[0].user_message.contains("ffmpeg"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn accepts_direct_release_layout_with_nested_resources_folder() {
        let dir = unique_temp_dir("nested-resources");
        let bin_dir = dir.join("resources").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("ffmpeg.exe"), b"binary").unwrap();
        let manifest = r#"
        {
          "assets": [
            {
              "id": "ffmpeg",
              "feature": "recording",
              "displayName": "Gravacao de tela",
              "platform": "windows-x64",
              "runtimePath": "bin/ffmpeg.exe",
              "packagePath": "resources/bin/ffmpeg.exe",
              "version": "test",
              "license": "test",
              "source": "test",
              "sha256": "9a3a45d01531a20e89ac6ae10b0b0beb0492acd7216a368aa062d1a5fecaf9cd",
              "repairUrl": "https://example.test/ffmpeg.exe"
            }
          ]
        }
        "#;

        let readiness = readiness_for_manifest_in_dir(&dir, manifest).unwrap();

        assert_eq!(
            readiness.assets[0].status,
            RuntimeAssetStatusCode::Available
        );
        let _ = fs::remove_dir_all(dir);
    }
}
