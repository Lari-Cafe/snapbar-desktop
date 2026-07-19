use sha2::{Digest, Sha256};
use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=runtime-assets.json");
    println!("cargo:rerun-if-changed=resources/bin");
    if env::var("CARGO_CFG_WINDOWS").is_ok() {
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }

    if env::var("PROFILE").as_deref() == Ok("release") {
        if let Err(err) = validate_runtime_assets() {
            panic!("{err}");
        }
    }

    tauri_build::build()
}

fn validate_runtime_assets() -> Result<(), String> {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?;
    let manifest_path = Path::new(&manifest_dir).join("runtime-assets.json");
    let manifest_text = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("runtime asset manifest ausente: {e}"))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_text)
        .map_err(|e| format!("runtime asset manifest invalido: {e}"))?;
    let assets = manifest
        .get("assets")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "runtime asset manifest sem lista assets".to_string())?;

    let mut failures = Vec::new();
    for asset in assets {
        let id = asset
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or("asset");
        let package_path = asset
            .get("packagePath")
            .and_then(|value| value.as_str())
            .ok_or_else(|| format!("asset {id} sem packagePath"))?;
        let expected_sha = asset
            .get("sha256")
            .and_then(|value| value.as_str())
            .ok_or_else(|| format!("asset {id} sem sha256"))?;

        if !is_sha256(expected_sha) {
            failures.push(format!("{id}: sha256 do manifest ainda nao foi definido"));
            continue;
        }

        let path = Path::new(&manifest_dir).join(package_path);
        if !path.is_file() {
            failures.push(format!("{id}: arquivo ausente em {}", path.display()));
            continue;
        }

        match sha256_file(&path) {
            Ok(actual) if actual.eq_ignore_ascii_case(expected_sha) => {}
            Ok(actual) => failures.push(format!(
                "{id}: checksum invalido; esperado {expected_sha}, encontrado {actual}"
            )),
            Err(err) => failures.push(format!("{id}: nao foi possivel validar checksum: {err}")),
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Assets obrigatorios do Snapbar invalidos para release:\n{}",
            failures.join("\n")
        ))
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}
