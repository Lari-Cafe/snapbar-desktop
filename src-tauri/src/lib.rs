
mod internet_downloads;
mod media_mixer;
mod notes_window;
mod process;
mod productivity;
mod recording;
mod runtime_assets;
mod screenshot;
mod secure_store;
mod settings_window;
mod shortcuts;
mod speech;
mod text_insertion;
mod tool_paths;
mod typo_fire;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

const RESTORE_AFTER_SCREENCLIP_OPEN_MS: u64 = 700;

// Restore mínimo: só mostra + foco. O front re-hidrata size/position/edge/expanded
// do tauri-plugin-store ao receber o evento `toolbar://restored`.
fn restore_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        // Truque Windows pra trazer janela pra frente sem precisar de foco
        let _ = window.set_always_on_top(false);
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();

        // Front escuta esse evento e chama hydrateFromStore()
        let _ = window.emit("toolbar://restored", ());

        eprintln!("[tray] restored window (front re-hidrata via store)");
    } else {
        eprintln!("[tray] main window not found");
    }
}

fn restore_capture_window(window: &tauri::Window) {
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("toolbar://restored", ());
}

#[tauri::command]
fn hide_to_tray(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn show_window(app: AppHandle) -> Result<(), String> {
    restore_window(&app);
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn local_dir_exists(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
fn local_file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// Abre o recorte nativo do Windows para captura manual. Esconde a toolbar
/// antes, salva a imagem selecionada e mostra a janela de volta.
#[tauri::command]
async fn capture_screen(
    window: tauri::Window,
    options: Option<screenshot::ScreenshotOptions>,
) -> Result<String, String> {
    // Esconde a toolbar pra ela não aparecer no recorte.
    window.hide().map_err(|e| format!("hide: {e}"))?;

    // Pequena espera pro compositor remover a janela antes de abrir o recorte.
    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(180));
    })
    .await
    .map_err(|e| format!("sleep join: {e}"))?;

    // O ScreenClip tira o snapshot logo ao abrir. Restaura a toolbar enquanto o
    // usuário ainda seleciona a área para ela não parecer minimizada/sumida.
    let early_restore_window = window.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(std::time::Duration::from_millis(
                RESTORE_AFTER_SCREENCLIP_OPEN_MS,
            ));
        })
        .await;
        restore_capture_window(&early_restore_window);
    });

    // O recorte nativo bloqueia até o usuário selecionar uma área ou cancelar.
    let result = tauri::async_runtime::spawn_blocking(move || screenshot::capture_screen(options))
        .await
        .map_err(|e| format!("capture join: {e}"))?;

    // Restaura a janela independentemente do resultado da captura.
    restore_capture_window(&window);

    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            restore_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(recording::RecordingState::default())
        .manage(internet_downloads::InternetDownloadState::default())
        .manage(shortcuts::ShortcutState::default())
        .manage(typo_fire::TypoFireState::default())
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Mostrar toolbar", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            text_insertion::start_focus_tracker();
            let productivity_store = productivity::ProductivityStore::load(app.handle())
                .map_err(std::io::Error::other)?;
            app.manage(productivity_store);
            productivity::start_productivity_scheduler(app.handle().clone());

            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or("no default window icon")?;

            let tray = TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("Snapbar - clique pra mostrar")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    eprintln!("[tray] menu event: {:?}", event.id);
                    match event.id.as_ref() {
                        "show" => restore_window(app),
                        "quit" => {
                            // Avisa o front pra flushar settings antes de morrer.
                            // Dá 300ms pra debounce de save terminar no disco.
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("app://before-quit", ());
                            }
                            let app_clone = app.clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_millis(300));
                                app_clone.exit(0);
                            });
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        eprintln!("[tray] left click");
                        restore_window(tray.app_handle());
                    }
                })
                .build(app)?;
            // Mantem o tray vivo no estado da app pra não ser dropado
            app.manage(tray);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_to_tray,
            show_window,
            quit_app,

            local_dir_exists,
            local_file_exists,
            capture_screen,
            secure_store::secure_store_get,
            secure_store::secure_store_set,
            secure_store::secure_store_delete,
            runtime_assets::runtime_readiness,
            internet_downloads::open_downloads_window,
            internet_downloads::internet_download_probe,
            internet_downloads::internet_download_start,
            internet_downloads::internet_download_cancel,
            media_mixer::open_media_mixer_window,
            media_mixer::media_mixer_snapshot,
            media_mixer::media_mixer_transport,
            media_mixer::media_mixer_set_master_volume,
            media_mixer::media_mixer_set_master_muted,
            media_mixer::media_mixer_set_microphone_muted,
            media_mixer::media_mixer_set_session_volume,
            media_mixer::media_mixer_set_session_muted,
            productivity::open_todo_calendar_window,
            productivity::open_pomodoro_window,
            productivity::open_productivity_alert_window,
            productivity::productivity_get_state,
            productivity::productivity_save_state,
            productivity::productivity_upsert_todo,
            productivity::productivity_complete_todo,
            productivity::productivity_delete_todo,
            productivity::productivity_snooze_todo,
            productivity::productivity_dismiss_todo_alert,
            productivity::pomodoro_start_timer,
            productivity::pomodoro_pause_timer,
            productivity::pomodoro_resume_timer,
            productivity::pomodoro_reset_timer,
            productivity::pomodoro_skip_round,
            recording::start_screen_recording,
            recording::stop_screen_recording,
            recording::list_recording_audio_sources,
            speech::toggle_windows_voice_typing,
            settings_window::open_settings_window,
            settings_window::close_settings_window,
            notes_window::open_note_window,
            notes_window::close_note_window,
            notes_window::any_note_window_open,
            notes_window::close_all_note_windows,
            shortcuts::register_shortcut,
            shortcuts::unregister_shortcut,
            shortcuts::unregister_all_shortcuts,
            typo_fire::open_typo_fire_window,
            typo_fire::typo_fire_status,
            typo_fire::typo_fire_set_enabled,
            typo_fire::typo_fire_configure,
            typo_fire::typo_fire_reload,
            typo_fire::typo_fire_preview_expansion,
            typo_fire::typo_fire_preview_suggestions,
            typo_fire::typo_fire_current_suggestions,
            typo_fire::typo_fire_apply_suggestion,
            typo_fire::typo_fire_push_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
