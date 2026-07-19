use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const SETTINGS_LABEL: &str = "settings";
const SETTINGS_W: f64 = 980.0;
const SETTINGS_H: f64 = 720.0;
const SETTINGS_MIN_W: f64 = 860.0;
const SETTINGS_MIN_H: f64 = 640.0;
const SETTINGS_TITLE: &str = "Configuracoes";
const SETTINGS_URL: &str = "index.html#/settings";

struct SettingsWindowSpec {
    label: &'static str,
    title: &'static str,
    url: &'static str,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    always_on_top: bool,
    skip_taskbar: bool,
}

fn settings_window_spec() -> SettingsWindowSpec {
    SettingsWindowSpec {
        label: SETTINGS_LABEL,
        title: SETTINGS_TITLE,
        url: SETTINGS_URL,
        width: SETTINGS_W,
        height: SETTINGS_H,
        min_width: SETTINGS_MIN_W,
        min_height: SETTINGS_MIN_H,
        always_on_top: true,
        skip_taskbar: true,
    }
}

fn reveal_tool_window(win: &WebviewWindow) {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

async fn open_tool_window(app: AppHandle, spec: SettingsWindowSpec) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(spec.label) {
        reveal_tool_window(&existing);
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(&app, spec.label, WebviewUrl::App(spec.url.into()))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .min_inner_size(spec.min_width, spec.min_height)
        .decorations(false)
        .transparent(true)
        .skip_taskbar(spec.skip_taskbar)
        .center()
        .always_on_top(spec.always_on_top)
        .resizable(true)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|e| format!("create {} window: {e}", spec.label))?;

    reveal_tool_window(&win);
    Ok(())
}

/// Abre (ou foca) a janela de configurações.
/// Janela é frameless, transparente, centralizada, sem taskbar.
#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> Result<(), String> {
    open_tool_window(app, settings_window_spec()).await
}

/// Fecha a janela de configurações se estiver aberta.
#[tauri::command]
pub fn close_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::Future;

    fn assert_async_command<F, Fut>(_command: F)
    where
        F: Fn(AppHandle) -> Fut,
        Fut: Future<Output = Result<(), String>>,
    {
    }

    #[test]
    fn settings_window_stays_above_other_windows() {
        let spec = settings_window_spec();

        assert!(spec.always_on_top);
        assert!(spec.skip_taskbar);
    }

    #[test]
    fn settings_window_has_room_for_future_sections() {
        let spec = settings_window_spec();

        assert!(spec.width >= 980.0);
        assert!(spec.height >= 720.0);
        assert!(spec.min_width <= spec.width);
        assert!(spec.min_height <= spec.height);
        assert!(spec.width > spec.height);
    }

    #[test]
    fn open_settings_window_is_async_to_avoid_windows_webview_deadlock() {
        assert_async_command(open_settings_window);
    }
}
