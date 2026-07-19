use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const MEDIA_MIXER_LABEL: &str = "media-mixer";
const MEDIA_MIXER_URL: &str = "index.html#/media-mixer";
const MEDIA_MIXER_COMPACT_W: f64 = 620.0;
const MEDIA_MIXER_COMPACT_H: f64 = 92.0;
const MEDIA_MIXER_EXPANDED_W: f64 = 780.0;
const MEDIA_MIXER_EXPANDED_H: f64 = 214.0;
const UNAVAILABLE_MESSAGE: &str = "Controle de midia indisponivel neste Windows.";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaMixerSnapshot {
    pub available: bool,
    pub message: Option<String>,
    pub master: MasterVolumeSnapshot,
    pub microphone: MicrophoneSnapshot,
    pub now_playing: Option<NowPlayingSnapshot>,
    pub sessions: Vec<AppVolumeSnapshot>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MasterVolumeSnapshot {
    pub volume: f32,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneSnapshot {
    pub available: bool,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingSnapshot {
    pub title: String,
    pub artist: String,
    pub app_name: String,
    pub playback_status: String,
    pub can_play: bool,
    pub can_pause: bool,
    pub can_skip_next: bool,
    pub can_skip_previous: bool,
    pub thumbnail_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppVolumeSnapshot {
    pub id: String,
    pub app_name: String,
    pub display_name: String,
    pub icon_data_url: Option<String>,
    pub volume: f32,
    pub muted: bool,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct RawAudioSession {
    id_seed: String,
    app_name: String,
    display_name: String,
    icon_data_url: Option<String>,
    volume: f32,
    muted: bool,
    active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransportAction {
    PlayPause,
    Next,
    Previous,
}

fn reveal_media_mixer_window(win: &WebviewWindow) {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

fn default_media_mixer_position(app: &AppHandle) -> Option<(f64, f64)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let position = monitor.position();
    let size = monitor.size();
    let x = position.x as f64 / scale + size.width as f64 / scale - MEDIA_MIXER_COMPACT_W - 24.0;
    let y = position.y as f64 / scale + 24.0;
    Some((x.max(0.0), y.max(0.0)))
}

#[tauri::command]
pub async fn open_media_mixer_window(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(MEDIA_MIXER_LABEL) {
        existing
            .close()
            .map_err(|_| "Nao foi possivel fechar o mixer de midia.".to_string())?;
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        MEDIA_MIXER_LABEL,
        WebviewUrl::App(MEDIA_MIXER_URL.into()),
    )
    .title("Mixer")
    .inner_size(MEDIA_MIXER_COMPACT_W, MEDIA_MIXER_COMPACT_H)
    .min_inner_size(MEDIA_MIXER_COMPACT_W, MEDIA_MIXER_COMPACT_H)
    .max_inner_size(MEDIA_MIXER_EXPANDED_W, MEDIA_MIXER_EXPANDED_H)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .resizable(false)
    .shadow(false)
    .visible(false);

    if let Some((x, y)) = default_media_mixer_position(&app) {
        builder = builder.position(x, y);
    }

    let win = builder
        .build()
        .map_err(|_| "Nao foi possivel abrir o mixer de midia.".to_string())?;

    reveal_media_mixer_window(&win);
    Ok(())
}

#[tauri::command]
pub async fn media_mixer_snapshot() -> Result<MediaMixerSnapshot, String> {
    Ok(platform_snapshot().await)
}

#[tauri::command]
pub async fn media_mixer_transport(action: String) -> Result<MediaMixerSnapshot, String> {
    let action = parse_transport_action(&action)?;
    platform_transport(action).await?;
    Ok(platform_snapshot().await)
}

#[tauri::command]
pub async fn media_mixer_set_master_volume(volume: f32) -> Result<MediaMixerSnapshot, String> {
    let volume = clamp_volume(volume)?;
    platform_set_master_volume(volume)?;
    Ok(platform_snapshot().await)
}

#[tauri::command]
pub async fn media_mixer_set_master_muted(muted: bool) -> Result<MediaMixerSnapshot, String> {
    platform_set_master_muted(muted)?;
    Ok(platform_snapshot().await)
}

#[tauri::command]
pub async fn media_mixer_set_microphone_muted(muted: bool) -> Result<MediaMixerSnapshot, String> {
    platform_set_microphone_muted(muted)?;
    Ok(platform_snapshot().await)
}

#[tauri::command]
pub async fn media_mixer_set_session_volume(
    session_id: String,
    volume: f32,
) -> Result<MediaMixerSnapshot, String> {
    let volume = clamp_volume(volume)?;
    let session_id = validate_session_id(&session_id)?;
    platform_set_session_volume(&session_id, volume)?;
    Ok(platform_snapshot().await)
}

#[tauri::command]
pub async fn media_mixer_set_session_muted(
    session_id: String,
    muted: bool,
) -> Result<MediaMixerSnapshot, String> {
    let session_id = validate_session_id(&session_id)?;
    platform_set_session_muted(&session_id, muted)?;
    Ok(platform_snapshot().await)
}

fn unavailable_snapshot(message: &str) -> MediaMixerSnapshot {
    MediaMixerSnapshot {
        available: false,
        message: Some(message.to_string()),
        master: MasterVolumeSnapshot {
            volume: 0.0,
            muted: false,
        },
        microphone: MicrophoneSnapshot {
            available: false,
            muted: false,
        },
        now_playing: None,
        sessions: Vec::new(),
    }
}

fn clamp_volume(value: f32) -> Result<f32, String> {
    if !value.is_finite() {
        return Err("Volume invalido.".to_string());
    }
    Ok(value.clamp(0.0, 1.0))
}

fn validate_session_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.starts_with("app-")
        && trimmed.len() <= 40
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    {
        return Ok(trimmed.to_string());
    }
    Err("Sessao de audio invalida.".to_string())
}

fn parse_transport_action(action: &str) -> Result<TransportAction, String> {
    match action {
        "playPause" => Ok(TransportAction::PlayPause),
        "next" => Ok(TransportAction::Next),
        "previous" => Ok(TransportAction::Previous),
        _ => Err("Acao de midia invalida.".to_string()),
    }
}

fn public_session_id(seed: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("app-{hex}")
}

fn app_name_from_path(path: &str) -> Option<String> {
    let name = Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(name.to_string())
}

fn simplified_app_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "Audio".to_string();
    }
    trimmed
        .split(['!', '\\', '/', ':'])
        .filter(|part| !part.trim().is_empty())
        .next_back()
        .unwrap_or(trimmed)
        .trim_end_matches(".exe")
        .trim()
        .chars()
        .take(48)
        .collect()
}

fn group_audio_sessions(raw_sessions: Vec<RawAudioSession>) -> Vec<AppVolumeSnapshot> {
    #[derive(Default)]
    struct Group {
        app_name: String,
        display_name: String,
        icon_data_url: Option<String>,
        volume_sum: f32,
        count: usize,
        muted_count: usize,
        active: bool,
    }

    let mut groups: HashMap<String, Group> = HashMap::new();
    for raw in raw_sessions {
        if raw.id_seed.trim().is_empty() || raw.app_name.trim().is_empty() {
            continue;
        }
        let id = public_session_id(&raw.id_seed);
        let entry = groups.entry(id).or_default();
        if entry.app_name.is_empty() {
            entry.app_name = raw.app_name;
        }
        if entry.display_name.is_empty() {
            entry.display_name = raw.display_name;
        }
        if entry.icon_data_url.is_none() {
            entry.icon_data_url = raw.icon_data_url;
        }
        entry.volume_sum += raw.volume.clamp(0.0, 1.0);
        entry.count += 1;
        if raw.muted {
            entry.muted_count += 1;
        }
        entry.active |= raw.active;
    }

    let mut sessions = groups
        .into_iter()
        .filter_map(|(id, group)| {
            if group.count == 0 || !group.active {
                return None;
            }
            let app_name = simplified_app_name(&group.app_name);
            let display_name = simplified_app_name(if group.display_name.is_empty() {
                &group.app_name
            } else {
                &group.display_name
            });
            Some(AppVolumeSnapshot {
                id,
                app_name,
                display_name,
                icon_data_url: group.icon_data_url,
                volume: (group.volume_sum / group.count as f32).clamp(0.0, 1.0),
                muted: group.muted_count == group.count,
                active: group.active,
            })
        })
        .collect::<Vec<_>>();

    sessions.sort_by(|a, b| {
        b.active.cmp(&a.active).then_with(|| {
            a.display_name
                .to_lowercase()
                .cmp(&b.display_name.to_lowercase())
        })
    });
    sessions
}

#[cfg(not(windows))]
async fn platform_snapshot() -> MediaMixerSnapshot {
    unavailable_snapshot(UNAVAILABLE_MESSAGE)
}

#[cfg(not(windows))]
async fn platform_transport(_action: TransportAction) -> Result<(), String> {
    Err(UNAVAILABLE_MESSAGE.to_string())
}

#[cfg(not(windows))]
fn platform_set_master_volume(_volume: f32) -> Result<(), String> {
    Err(UNAVAILABLE_MESSAGE.to_string())
}

#[cfg(not(windows))]
fn platform_set_master_muted(_muted: bool) -> Result<(), String> {
    Err(UNAVAILABLE_MESSAGE.to_string())
}

#[cfg(not(windows))]
fn platform_set_microphone_muted(_muted: bool) -> Result<(), String> {
    Err(UNAVAILABLE_MESSAGE.to_string())
}

#[cfg(not(windows))]
fn platform_set_session_volume(_session_id: &str, _volume: f32) -> Result<(), String> {
    Err(UNAVAILABLE_MESSAGE.to_string())
}

#[cfg(not(windows))]
fn platform_set_session_muted(_session_id: &str, _muted: bool) -> Result<(), String> {
    Err(UNAVAILABLE_MESSAGE.to_string())
}

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::{io::Cursor, ptr};
    use windows::{
        core::{Interface, BOOL, PCWSTR, PWSTR},
        Media::Control::{
            GlobalSystemMediaTransportControlsSession,
            GlobalSystemMediaTransportControlsSessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        },
        Storage::Streams::DataReader,
        Win32::{
            Foundation::{CloseHandle, LPARAM, WPARAM},
            Graphics::Gdi::{
                CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject,
                BITMAPINFO, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
            },
            Media::Audio::Endpoints::IAudioEndpointVolume,
            Media::Audio::{
                eCapture, eMultimedia, eRender, AudioSessionStateActive, IAudioSessionControl2,
                IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume,
                MMDeviceEnumerator,
            },
            Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES,
            System::{
                Com::{
                    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL,
                    COINIT_MULTITHREADED,
                },
                Threading::{
                    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                    PROCESS_QUERY_LIMITED_INFORMATION,
                },
            },
            UI::Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
                KEYEVENTF_KEYUP, VIRTUAL_KEY,
            },
            UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_SMALLICON},
            UI::WindowsAndMessaging::{
                DestroyIcon, DrawIconEx, SendMessageTimeoutW, DI_NORMAL, HWND_BROADCAST,
                SMTO_ABORTIFHUNG, WM_APPCOMMAND,
            },
        },
    };

    pub(super) async fn snapshot() -> MediaMixerSnapshot {
        match snapshot_inner().await {
            Ok(snapshot) => snapshot,
            Err(_) => unavailable_snapshot(UNAVAILABLE_MESSAGE),
        }
    }

    pub(super) async fn transport(action: TransportAction) -> Result<(), String> {
        if try_gsmtc_transport(action).await.unwrap_or(false)
            || send_app_command(action)
            || send_media_key(action)
        {
            Ok(())
        } else {
            Err("Este app nao aceitou o comando de midia.".to_string())
        }
    }

    async fn try_gsmtc_transport(action: TransportAction) -> windows::core::Result<bool> {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
        let session = manager.GetCurrentSession()?;
        match action {
            TransportAction::PlayPause => session.TryTogglePlayPauseAsync()?.await,
            TransportAction::Next => session.TrySkipNextAsync()?.await,
            TransportAction::Previous => session.TrySkipPreviousAsync()?.await,
        }
    }

    fn send_app_command(action: TransportAction) -> bool {
        const APPCOMMAND_MEDIA_NEXTTRACK: u32 = 11;
        const APPCOMMAND_MEDIA_PREVIOUSTRACK: u32 = 12;
        const APPCOMMAND_MEDIA_PLAY_PAUSE: u32 = 14;
        let command = match action {
            TransportAction::PlayPause => APPCOMMAND_MEDIA_PLAY_PAUSE,
            TransportAction::Next => APPCOMMAND_MEDIA_NEXTTRACK,
            TransportAction::Previous => APPCOMMAND_MEDIA_PREVIOUSTRACK,
        };
        let mut result = 0usize;
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_APPCOMMAND,
                WPARAM(0),
                LPARAM((command << 16) as isize),
                SMTO_ABORTIFHUNG,
                150,
                Some(&mut result as *mut usize),
            )
            .0 != 0
        }
    }

    fn send_media_key(action: TransportAction) -> bool {
        const VK_MEDIA_NEXT_TRACK: VIRTUAL_KEY = VIRTUAL_KEY(0xB0);
        const VK_MEDIA_PREV_TRACK: VIRTUAL_KEY = VIRTUAL_KEY(0xB1);
        const VK_MEDIA_PLAY_PAUSE: VIRTUAL_KEY = VIRTUAL_KEY(0xB3);
        let key = match action {
            TransportAction::PlayPause => VK_MEDIA_PLAY_PAUSE,
            TransportAction::Next => VK_MEDIA_NEXT_TRACK,
            TransportAction::Previous => VK_MEDIA_PREV_TRACK,
        };
        let inputs = [key_input(key, false), key_input(key, true)];
        unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) == inputs.len() as u32 }
    }

    fn key_input(key: VIRTUAL_KEY, key_up: bool) -> INPUT {
        let mut flags = KEYEVENTF_EXTENDEDKEY;
        if key_up {
            flags |= KEYEVENTF_KEYUP;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub(super) fn set_master_volume(volume: f32) -> Result<(), String> {
        let endpoint = endpoint_volume()
            .map_err(|_| "Nao foi possivel alterar o volume geral.".to_string())?;
        unsafe {
            endpoint
                .SetMasterVolumeLevelScalar(volume, ptr::null())
                .map_err(|_| "Nao foi possivel alterar o volume geral.".to_string())
        }
    }

    pub(super) fn set_master_muted(muted: bool) -> Result<(), String> {
        let endpoint =
            endpoint_volume().map_err(|_| "Nao foi possivel alterar o mute geral.".to_string())?;
        unsafe {
            endpoint
                .SetMute(muted, ptr::null())
                .map_err(|_| "Nao foi possivel alterar o mute geral.".to_string())
        }
    }

    pub(super) fn set_microphone_muted(muted: bool) -> Result<(), String> {
        let endpoint = microphone_endpoint_volume()
            .map_err(|_| "Nao foi possivel alterar o mute do microfone.".to_string())?;
        unsafe {
            endpoint
                .SetMute(muted, ptr::null())
                .map_err(|_| "Nao foi possivel alterar o mute do microfone.".to_string())
        }
    }

    pub(super) fn set_session_volume(session_id: &str, volume: f32) -> Result<(), String> {
        let raw_sessions = enumerate_raw_sessions()
            .map_err(|_| "Nao foi possivel alterar o volume deste app.".to_string())?;
        let mut changed = false;
        for (raw, simple) in raw_sessions {
            if public_session_id(&raw.id_seed) == session_id {
                unsafe {
                    simple
                        .SetMasterVolume(volume, ptr::null())
                        .map_err(|_| "Nao foi possivel alterar o volume deste app.".to_string())?;
                }
                changed = true;
            }
        }
        if changed {
            Ok(())
        } else {
            Err("Este app nao esta mais tocando audio.".to_string())
        }
    }

    pub(super) fn set_session_muted(session_id: &str, muted: bool) -> Result<(), String> {
        let raw_sessions = enumerate_raw_sessions()
            .map_err(|_| "Nao foi possivel alterar o mute deste app.".to_string())?;
        let mut changed = false;
        for (raw, simple) in raw_sessions {
            if public_session_id(&raw.id_seed) == session_id {
                unsafe {
                    simple
                        .SetMute(muted, ptr::null())
                        .map_err(|_| "Nao foi possivel alterar o mute deste app.".to_string())?;
                }
                changed = true;
            }
        }
        if changed {
            Ok(())
        } else {
            Err("Este app nao esta mais tocando audio.".to_string())
        }
    }

    async fn snapshot_inner() -> windows::core::Result<MediaMixerSnapshot> {
        let master = master_volume().unwrap_or(MasterVolumeSnapshot {
            volume: 0.0,
            muted: false,
        });
        let microphone = microphone_volume().unwrap_or(MicrophoneSnapshot {
            available: false,
            muted: false,
        });
        let sessions = enumerate_raw_sessions()
            .map(|items| group_audio_sessions(items.into_iter().map(|(raw, _)| raw).collect()))
            .unwrap_or_default();
        let now_playing = now_playing().await.ok().flatten();
        let available =
            master.volume > 0.0 || master.muted || now_playing.is_some() || !sessions.is_empty();

        Ok(MediaMixerSnapshot {
            available,
            message: if available {
                None
            } else {
                Some("Nenhum audio ativo agora.".to_string())
            },
            master,
            microphone,
            now_playing,
            sessions,
        })
    }

    fn ensure_com() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    fn default_audio_device() -> windows::core::Result<IMMDevice> {
        ensure_com();
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
        unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
    }

    fn default_microphone_device() -> windows::core::Result<IMMDevice> {
        ensure_com();
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
        unsafe { enumerator.GetDefaultAudioEndpoint(eCapture, eMultimedia) }
    }

    fn endpoint_volume() -> windows::core::Result<IAudioEndpointVolume> {
        let device = default_audio_device()?;
        unsafe { device.Activate(CLSCTX_ALL, None) }
    }

    fn microphone_endpoint_volume() -> windows::core::Result<IAudioEndpointVolume> {
        let device = default_microphone_device()?;
        unsafe { device.Activate(CLSCTX_ALL, None) }
    }

    fn session_manager() -> windows::core::Result<IAudioSessionManager2> {
        let device = default_audio_device()?;
        unsafe { device.Activate(CLSCTX_ALL, None) }
    }

    fn master_volume() -> windows::core::Result<MasterVolumeSnapshot> {
        let endpoint = endpoint_volume()?;
        let volume = unsafe { endpoint.GetMasterVolumeLevelScalar()? }.clamp(0.0, 1.0);
        let muted = unsafe { endpoint.GetMute()? }.as_bool();
        Ok(MasterVolumeSnapshot { volume, muted })
    }

    fn microphone_volume() -> windows::core::Result<MicrophoneSnapshot> {
        let endpoint = microphone_endpoint_volume()?;
        let muted = unsafe { endpoint.GetMute()? }.as_bool();
        Ok(MicrophoneSnapshot {
            available: true,
            muted,
        })
    }

    fn enumerate_raw_sessions() -> windows::core::Result<Vec<(RawAudioSession, ISimpleAudioVolume)>>
    {
        let manager = session_manager()?;
        let enumerator = unsafe { manager.GetSessionEnumerator()? };
        let count = unsafe { enumerator.GetCount()? };
        let mut sessions = Vec::new();

        for index in 0..count {
            let control = unsafe { enumerator.GetSession(index)? };
            let state = unsafe { control.GetState()? };
            let control2: IAudioSessionControl2 = match control.cast() {
                Ok(value) => value,
                Err(_) => continue,
            };
            let simple: ISimpleAudioVolume = match control.cast() {
                Ok(value) => value,
                Err(_) => continue,
            };
            let pid = unsafe { control2.GetProcessId().unwrap_or(0) };
            let display_name = unsafe { owned_pwstr_to_string(control.GetDisplayName().ok()) };
            let instance = unsafe {
                owned_pwstr_to_string(control2.GetSessionInstanceIdentifier().ok())
                    .unwrap_or_else(|| format!("pid-{pid}"))
            };
            let exe_path = process_image_path(pid);
            let icon_data_url = exe_path.as_deref().and_then(executable_icon_data_url);
            let app_name = exe_path
                .as_deref()
                .and_then(app_name_from_path)
                .or(display_name.clone())
                .unwrap_or_else(|| {
                    if pid == 0 {
                        "Sons do sistema".to_string()
                    } else {
                        "Audio".to_string()
                    }
                });
            let id_seed = exe_path.unwrap_or(instance);
            let volume = unsafe { simple.GetMasterVolume().unwrap_or(0.0) }.clamp(0.0, 1.0);
            let muted = unsafe { simple.GetMute().unwrap_or(BOOL::from(false)).as_bool() };

            sessions.push((
                RawAudioSession {
                    id_seed,
                    app_name: app_name.clone(),
                    display_name: display_name.unwrap_or(app_name),
                    icon_data_url,
                    volume,
                    muted,
                    active: state == AudioSessionStateActive,
                },
                simple,
            ));
        }

        Ok(sessions)
    }

    fn executable_icon_data_url(path: &str) -> Option<String> {
        const ICON_SIZE: i32 = 24;
        let mut wide = path.encode_utf16().collect::<Vec<_>>();
        wide.push(0);
        let mut info = SHFILEINFOW::default();
        let ok = unsafe {
            SHGetFileInfoW(
                PCWSTR(wide.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(0),
                Some(&mut info),
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_SMALLICON,
            )
        };
        if ok == 0 || info.hIcon.is_invalid() {
            return None;
        }
        let encoded = unsafe { hicon_png_data_url(info.hIcon, ICON_SIZE) };
        let _ = unsafe { DestroyIcon(info.hIcon) };
        encoded
    }

    unsafe fn hicon_png_data_url(
        icon: windows::Win32::UI::WindowsAndMessaging::HICON,
        size: i32,
    ) -> Option<String> {
        let hdc = unsafe { CreateCompatibleDC(None) };
        if hdc.is_invalid() {
            return None;
        }

        let mut bits: *mut core::ffi::c_void = core::ptr::null_mut();
        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
        info.bmiHeader.biWidth = size;
        info.bmiHeader.biHeight = -size;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB.0;

        let bitmap =
            match unsafe { CreateDIBSection(Some(hdc), &info, DIB_RGB_COLORS, &mut bits, None, 0) }
            {
                Ok(bitmap) => bitmap,
                Err(_) => {
                    let _ = unsafe { DeleteDC(hdc) };
                    return None;
                }
            };
        if bitmap.is_invalid() || bits.is_null() {
            let _ = unsafe { DeleteDC(hdc) };
            return None;
        }

        let byte_len = (size * size * 4) as usize;
        unsafe {
            std::ptr::write_bytes(bits, 0, byte_len);
        }
        let previous = unsafe { SelectObject(hdc, HGDIOBJ(bitmap.0)) };
        let drawn = unsafe { DrawIconEx(hdc, 0, 0, icon, size, size, 0, None, DI_NORMAL) }.is_ok();
        if !previous.is_invalid() {
            let _ = unsafe { SelectObject(hdc, previous) };
        }

        let rgba = if drawn {
            let bgra = unsafe { std::slice::from_raw_parts(bits as *const u8, byte_len) };
            let has_alpha = bgra.chunks_exact(4).any(|px| px[3] != 0);
            let mut rgba = Vec::with_capacity(byte_len);
            for px in bgra.chunks_exact(4) {
                rgba.push(px[2]);
                rgba.push(px[1]);
                rgba.push(px[0]);
                rgba.push(if has_alpha {
                    px[3]
                } else if px[0] == 0 && px[1] == 0 && px[2] == 0 {
                    0
                } else {
                    255
                });
            }
            Some(rgba)
        } else {
            None
        };

        let _ = unsafe { DeleteObject(HGDIOBJ(bitmap.0)) };
        let _ = unsafe { DeleteDC(hdc) };
        let image = image::RgbaImage::from_raw(size as u32, size as u32, rgba?)?;
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut png, image::ImageFormat::Png)
            .ok()?;
        Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(png.into_inner())
        ))
    }

    async fn now_playing() -> windows::core::Result<Option<NowPlayingSnapshot>> {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
        let session = match manager.GetCurrentSession() {
            Ok(session) => session,
            Err(_) => return Ok(None),
        };
        now_playing_from_session(session).await.map(Some)
    }

    async fn now_playing_from_session(
        session: GlobalSystemMediaTransportControlsSession,
    ) -> windows::core::Result<NowPlayingSnapshot> {
        let props = session.TryGetMediaPropertiesAsync()?.await?;
        let playback = session.GetPlaybackInfo()?;
        let controls = playback.Controls()?;
        let status = match playback.PlaybackStatus()? {
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => "playing",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => "paused",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => "stopped",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing => "changing",
            _ => "idle",
        };
        let title = props
            .Title()
            .map(|value| value.to_string_lossy())
            .unwrap_or_default();
        let artist = props
            .Artist()
            .map(|value| value.to_string_lossy())
            .unwrap_or_default();
        let app_name = session
            .SourceAppUserModelId()
            .map(|value| simplified_app_name(&value.to_string_lossy()))
            .unwrap_or_else(|_| "Midia".to_string());

        Ok(NowPlayingSnapshot {
            title,
            artist,
            app_name,
            playback_status: status.to_string(),
            can_play: controls.IsPlayEnabled().unwrap_or(false),
            can_pause: controls.IsPauseEnabled().unwrap_or(false),
            can_skip_next: controls.IsNextEnabled().unwrap_or(false),
            can_skip_previous: controls.IsPreviousEnabled().unwrap_or(false),
            thumbnail_data_url: thumbnail_data_url(&props).await,
        })
    }

    async fn thumbnail_data_url(
        props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
    ) -> Option<String> {
        const MAX_THUMBNAIL_BYTES: u64 = 1_500_000;

        let open_operation = {
            let reference = props.Thumbnail().ok()?;
            reference.OpenReadAsync().ok()?
        };
        let (reader, load_operation) = {
            let stream = open_operation.await.ok()?;
            let size = stream.Size().ok()?;
            if size == 0 || size > MAX_THUMBNAIL_BYTES {
                return None;
            }
            let input = stream.GetInputStreamAt(0).ok()?;
            let reader = DataReader::CreateDataReader(&input).ok()?;
            let load_operation = reader.LoadAsync(size as u32).ok()?;
            (reader, load_operation)
        };
        let loaded = load_operation.await.ok()?;
        if loaded == 0 {
            return None;
        }
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        let mime = image_mime(&bytes)?;
        Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    }

    fn image_mime(bytes: &[u8]) -> Option<&'static str> {
        if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            Some("image/png")
        } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            Some("image/jpeg")
        } else if bytes.starts_with(b"GIF8") {
            Some("image/gif")
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            Some("image/webp")
        } else {
            None
        }
    }

    unsafe fn owned_pwstr_to_string(value: Option<PWSTR>) -> Option<String> {
        let value = value?;
        if value.is_null() {
            return None;
        }
        let text = value.to_string().ok();
        unsafe {
            CoTaskMemFree(Some(value.as_ptr() as _));
        }
        text.map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn process_image_path(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            if handle.is_invalid() {
                return None;
            }
            let mut buf = vec![0u16; 32768];
            let mut size = buf.len() as u32;
            let result = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(handle);
            result.ok()?;
            if size == 0 {
                return None;
            }
            Some(String::from_utf16_lossy(&buf[..size as usize]))
        }
    }
}

#[cfg(windows)]
async fn platform_snapshot() -> MediaMixerSnapshot {
    windows_impl::snapshot().await
}

#[cfg(windows)]
async fn platform_transport(action: TransportAction) -> Result<(), String> {
    windows_impl::transport(action).await
}

#[cfg(windows)]
fn platform_set_master_volume(volume: f32) -> Result<(), String> {
    windows_impl::set_master_volume(volume)
}

#[cfg(windows)]
fn platform_set_master_muted(muted: bool) -> Result<(), String> {
    windows_impl::set_master_muted(muted)
}

#[cfg(windows)]
fn platform_set_microphone_muted(muted: bool) -> Result<(), String> {
    windows_impl::set_microphone_muted(muted)
}

#[cfg(windows)]
fn platform_set_session_volume(session_id: &str, volume: f32) -> Result<(), String> {
    windows_impl::set_session_volume(session_id, volume)
}

#[cfg(windows)]
fn platform_set_session_muted(session_id: &str, muted: bool) -> Result<(), String> {
    windows_impl::set_session_muted(session_id, muted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_volume_to_native_scalar_range() {
        assert_eq!(clamp_volume(-0.4).unwrap(), 0.0);
        assert_eq!(clamp_volume(0.5).unwrap(), 0.5);
        assert_eq!(clamp_volume(1.4).unwrap(), 1.0);
        assert!(clamp_volume(f32::NAN).is_err());
    }

    #[test]
    fn parses_only_supported_transport_actions() {
        assert_eq!(
            parse_transport_action("playPause").unwrap(),
            TransportAction::PlayPause
        );
        assert_eq!(
            parse_transport_action("next").unwrap(),
            TransportAction::Next
        );
        assert_eq!(
            parse_transport_action("previous").unwrap(),
            TransportAction::Previous
        );
        assert!(parse_transport_action("seek").is_err());
    }

    #[test]
    fn groups_audio_sessions_without_exposing_paths() {
        let grouped = group_audio_sessions(vec![
            RawAudioSession {
                id_seed: r"C:\Program Files\Spotify\Spotify.exe".to_string(),
                app_name: "Spotify".to_string(),
                display_name: "Spotify".to_string(),
                icon_data_url: Some("data:image/png;base64,abc".to_string()),
                volume: 0.5,
                muted: false,
                active: true,
            },
            RawAudioSession {
                id_seed: r"C:\Program Files\Spotify\Spotify.exe".to_string(),
                app_name: "Spotify".to_string(),
                display_name: "Spotify".to_string(),
                icon_data_url: None,
                volume: 1.0,
                muted: false,
                active: false,
            },
        ]);

        assert_eq!(grouped.len(), 1);
        assert!(grouped[0].id.starts_with("app-"));
        assert!(!grouped[0].id.contains("Spotify.exe"));
        assert_eq!(
            grouped[0].icon_data_url.as_deref(),
            Some("data:image/png;base64,abc")
        );
        assert_eq!(grouped[0].volume, 0.75);
    }

    #[test]
    fn filters_inactive_sessions_from_public_snapshot() {
        let grouped = group_audio_sessions(vec![
            RawAudioSession {
                id_seed: "browser".to_string(),
                app_name: "Browser".to_string(),
                display_name: "Browser".to_string(),
                icon_data_url: None,
                volume: 0.4,
                muted: false,
                active: false,
            },
            RawAudioSession {
                id_seed: "spotify".to_string(),
                app_name: "Spotify".to_string(),
                display_name: "Spotify".to_string(),
                icon_data_url: None,
                volume: 0.8,
                muted: false,
                active: true,
            },
        ]);

        assert_eq!(grouped.len(), 1);
        assert_eq!(grouped[0].app_name, "Spotify");
    }

    #[test]
    fn validates_public_session_ids() {
        assert!(validate_session_id("app-0123abcd").is_ok());
        assert!(validate_session_id(r"C:\Users\Lari\app.exe").is_err());
        assert!(validate_session_id("bad id").is_err());
    }

    #[test]
    fn non_windows_fallback_shape_is_recoverable() {
        let snapshot = unavailable_snapshot(UNAVAILABLE_MESSAGE);

        assert!(!snapshot.available);
        assert_eq!(snapshot.message.as_deref(), Some(UNAVAILABLE_MESSAGE));
        assert!(!snapshot.microphone.available);
        assert!(snapshot.sessions.is_empty());
    }
}
