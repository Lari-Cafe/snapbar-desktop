use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// Estado dos atalhos registrados (action -> accelerator).
/// Mantemos um cache pra poder desregistrar antes de re-registrar.
#[derive(Default)]
pub struct ShortcutState {
    pub registered: Mutex<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutPayload {
    pub action: String,
}

/// Registra um atalho global. Se já existe um pra essa action, desregistra antes.
/// Quando disparado, emite evento `shortcut://triggered` com a action no payload,
/// que o frontend escuta pra executar a função correspondente.
#[tauri::command]
pub fn register_shortcut(
    app: AppHandle,
    action: String,
    accelerator: String,
) -> Result<(), String> {
    let state = app.state::<ShortcutState>();
    let gs = app.global_shortcut();

    // Desregistra atalho anterior dessa action, se existia
    {
        let mut map = state.registered.lock().map_err(|e| e.to_string())?;
        if let Some(prev) = map.remove(&action) {
            if let Ok(prev_shortcut) = prev.parse::<Shortcut>() {
                let _ = gs.unregister(prev_shortcut);
            }
        }
    }

    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|e| format!("invalid accelerator: {e}"))?;

    let action_for_handler = action.clone();
    let app_handle_for_handler = app.clone();
    gs.on_shortcut(shortcut, move |_app, _shortcut, event| {
        if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            let _ = app_handle_for_handler.emit(
                "shortcut://triggered",
                ShortcutPayload {
                    action: action_for_handler.clone(),
                },
            );
        }
    })
    .map_err(|e| format!("register shortcut: {e}"))?;

    let mut map = state.registered.lock().map_err(|e| e.to_string())?;
    map.insert(action, accelerator);
    Ok(())
}

/// Desregistra o atalho de uma action.
#[tauri::command]
pub fn unregister_shortcut(app: AppHandle, action: String) -> Result<(), String> {
    let state = app.state::<ShortcutState>();
    let gs = app.global_shortcut();

    let accelerator = {
        let mut map = state.registered.lock().map_err(|e| e.to_string())?;
        map.remove(&action)
    };

    if let Some(accelerator) = accelerator {
        let shortcut: Shortcut = accelerator
            .parse()
            .map_err(|e| format!("invalid accelerator: {e}"))?;
        gs.unregister(shortcut)
            .map_err(|e| format!("unregister: {e}"))?;
    }
    Ok(())
}

/// Desregistra todos os atalhos. Útil em shutdown ou reset.
#[tauri::command]
pub fn unregister_all_shortcuts(app: AppHandle) -> Result<(), String> {
    let state = app.state::<ShortcutState>();
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let mut map = state.registered.lock().map_err(|e| e.to_string())?;
    map.clear();
    Ok(())
}
