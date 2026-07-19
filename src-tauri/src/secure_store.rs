#[cfg(windows)]
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const SECURE_STORE_FILE: &str = "secure-store.json";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct SecureStoreFile {
    values: BTreeMap<String, String>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Nao foi possivel abrir o armazenamento seguro.".to_string())?;
    fs::create_dir_all(&dir)
        .map_err(|_| "Nao foi possivel preparar o armazenamento seguro.".to_string())?;
    Ok(dir.join(SECURE_STORE_FILE))
}

fn read_store(app: &AppHandle) -> SecureStoreFile {
    let Ok(path) = store_path(app) else {
        return SecureStoreFile::default();
    };
    let Ok(bytes) = fs::read(path) else {
        return SecureStoreFile::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn write_store(app: &AppHandle, store: &SecureStoreFile) -> Result<(), String> {
    let path = store_path(app)?;
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|_| "Nao foi possivel salvar o armazenamento seguro.".to_string())?;
    fs::write(path, bytes)
        .map_err(|_| "Nao foi possivel salvar o armazenamento seguro.".to_string())
}

fn valid_key(key: &str) -> bool {
    !key.trim().is_empty()
        && key.len() <= 120
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
}

#[cfg(windows)]
fn protect(value: &str) -> Result<String, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut input = value.as_bytes().to_vec();
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_mut_ptr(),
    };
    let mut out_blob = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &in_blob,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
        .map_err(|_| "Nao foi possivel proteger a sessao.".to_string())?;
        let bytes = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out_blob.pbData as _)));
        Ok(STANDARD.encode(bytes))
    }
}

#[cfg(windows)]
fn unprotect(value: &str) -> Result<String, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut input = STANDARD
        .decode(value.trim())
        .map_err(|_| "Sessao local invalida.".to_string())?;
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_mut_ptr(),
    };
    let mut out_blob = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &in_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
        .map_err(|_| "Sessao local invalida.".to_string())?;
        let bytes = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out_blob.pbData as _)));
        String::from_utf8(bytes).map_err(|_| "Sessao local invalida.".to_string())
    }
}

#[cfg(not(windows))]
fn protect(_value: &str) -> Result<String, String> {
    Err("Armazenamento seguro indisponivel fora do Windows.".to_string())
}

#[cfg(not(windows))]
fn unprotect(_value: &str) -> Result<String, String> {
    Err("Armazenamento seguro indisponivel fora do Windows.".to_string())
}

#[tauri::command]
pub fn secure_store_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    if !valid_key(&key) {
        return Err("Chave local invalida.".into());
    }
    let store = read_store(&app);
    match store.values.get(&key) {
        Some(value) => unprotect(value).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn secure_store_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    if !valid_key(&key) {
        return Err("Chave local invalida.".into());
    }
    let mut store = read_store(&app);
    store.values.insert(key, protect(&value)?);
    write_store(&app, &store)
}

#[tauri::command]
pub fn secure_store_delete(app: AppHandle, key: String) -> Result<(), String> {
    if !valid_key(&key) {
        return Err("Chave local invalida.".into());
    }
    let mut store = read_store(&app);
    store.values.remove(&key);
    write_store(&app, &store)
}

#[cfg(test)]
mod tests {
    use super::valid_key;

    #[test]
    fn secure_store_key_accepts_scoped_names_only() {
        assert!(valid_key("snapbar.recording_output"));
        assert!(valid_key("snapbar.local_setting"));
        assert!(!valid_key(""));
        assert!(!valid_key("../token"));
        assert!(!valid_key("token with spaces"));
        assert!(!valid_key(&"a".repeat(121)));
    }
}
