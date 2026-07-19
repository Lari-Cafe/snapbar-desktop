use std::{
    env,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

pub fn resolve_required_tool_path(
    app: Option<&AppHandle>,
    tool: &str,
    feature_name: &str,
) -> Result<PathBuf, String> {
    resolve_optional_tool_path(app, tool)
        .ok_or_else(|| missing_runtime_dependency_message(feature_name))
}

pub fn resolve_optional_tool_path(app: Option<&AppHandle>, tool: &str) -> Option<PathBuf> {
    let executable = tool_executable_name(tool);
    let env_key = format!("SNAPBAR_{}_PATH", tool.to_uppercase().replace('-', "_"));

    if cfg!(debug_assertions) {
        if let Ok(value) = env::var(env_key) {
            let path = PathBuf::from(value);
            if path.is_file() {
                return Some(path);
            }
        }
    }

    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            if let Some(path) = first_existing_tool(&resource_dir, tool, &executable) {
                return Some(path);
            }
        }
    }

    if let Ok(current_exe) = env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            if let Some(path) = first_existing_tool(exe_dir, tool, &executable) {
                return Some(path);
            }
        }
    }

    None
}

fn missing_runtime_dependency_message(feature_name: &str) -> String {
    format!(
        "{feature_name} nao esta disponivel nesta instalacao. Reinstale ou atualize o Snapbar para usar este recurso."
    )
}

fn first_existing_tool(base: &Path, tool: &str, executable: &str) -> Option<PathBuf> {
    [
        base.join(executable),
        base.join("bin").join(executable),
        base.join("tools").join(executable),
        base.join(tool).join(executable),
        base.join("resources").join("bin").join(executable),
        base.join("resources").join(tool).join(executable),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn tool_executable_name(tool: &str) -> String {
    if cfg!(windows) && !tool.ends_with(".exe") {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("snapbar-tool-paths-{name}-{nanos}"))
    }

    #[test]
    fn first_existing_tool_prefers_bundled_bin_folder() {
        let dir = unique_temp_dir("bin");
        let bin_dir = dir.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let ffmpeg = bin_dir.join(tool_executable_name("ffmpeg"));
        fs::write(&ffmpeg, "binary").unwrap();

        let found = first_existing_tool(&dir, "ffmpeg", &tool_executable_name("ffmpeg"));

        assert_eq!(found, Some(ffmpeg));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_dependency_message_is_user_facing() {
        let message = missing_runtime_dependency_message("Gravacao de tela");

        assert!(message.contains("Gravacao de tela"));
        assert!(message.contains("Reinstale ou atualize o Snapbar"));
        assert!(!message.contains("ffmpeg"));
    }
}
