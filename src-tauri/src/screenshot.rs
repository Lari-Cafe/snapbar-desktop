use std::{path::PathBuf, time::Duration};

use chrono::Local;
#[cfg(windows)]
use image::{ColorType, ImageFormat};
use serde::Deserialize;
#[cfg(not(windows))]
use xcap::Monitor;

#[cfg(windows)]
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotOptions {
    pub output_dir: Option<String>,
}

/// Captura uma imagem, salva como PNG em
/// `%USERPROFILE%\Pictures\FloatingToolbar\screenshot-YYYYMMDD-HHmmss.png`,
/// e retorna o path absoluto.
pub fn capture_screen(options: Option<ScreenshotOptions>) -> Result<String, String> {
    #[cfg(windows)]
    {
        return capture_with_windows_screenclip(options);
    }

    #[cfg(not(windows))]
    {
        capture_fullscreen(options)
    }
}

#[cfg(not(windows))]
fn capture_fullscreen(options: Option<ScreenshotOptions>) -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("xcap monitors: {e}"))?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or_else(|| "no primary monitor found".to_string())?;

    let image = monitor
        .capture_image()
        .map_err(|e| format!("xcap capture: {e}"))?;

    let dir = screenshots_dir(options.and_then(|value| value.output_dir))?;
    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let filename = format!("screenshot-{timestamp}.png");
    let path = dir.join(&filename);

    image.save(&path).map_err(|e| format!("save png: {e}"))?;

    // Clipboard: best-effort, falha silenciosa se o sistema bloquear acesso
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let img_data = arboard::ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: std::borrow::Cow::Borrowed(image.as_raw().as_slice()),
        };
        let _ = clipboard.set_image(img_data);
    }

    Ok(path.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn capture_with_windows_screenclip(options: Option<ScreenshotOptions>) -> Result<String, String> {
    let baseline = clipboard_sequence();
    open_windows_screenclip()?;
    let image = wait_for_new_clipboard_image(baseline, Duration::from_secs(60))?;
    save_clipboard_image(image, options)
}

#[cfg(windows)]
fn open_windows_screenclip() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg("ms-screenclip:")
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("screenclip start: {e}"))
}

#[cfg(windows)]
fn clipboard_sequence() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

#[cfg(windows)]
fn wait_for_new_clipboard_image(
    baseline: u32,
    timeout: Duration,
) -> Result<arboard::ImageData<'static>, String> {
    let started = std::time::Instant::now();

    while started.elapsed() < timeout {
        if clipboard_sequence() != baseline {
            match arboard::Clipboard::new().and_then(|mut clipboard| clipboard.get_image()) {
                Ok(image) => return Ok(image.to_owned()),
                Err(_) => {}
            }
        }
        std::thread::sleep(Duration::from_millis(180));
    }

    Err("Nenhum recorte foi selecionado.".to_string())
}

#[cfg(windows)]
fn save_clipboard_image(
    image: arboard::ImageData<'static>,
    options: Option<ScreenshotOptions>,
) -> Result<String, String> {
    let dir = screenshots_dir(options.and_then(|value| value.output_dir))?;
    let path = screenshot_path(dir);

    image::save_buffer_with_format(
        &path,
        image.bytes.as_ref(),
        image.width as u32,
        image.height as u32,
        ColorType::Rgba8,
        ImageFormat::Png,
    )
    .map_err(|e| format!("save png: {e}"))?;

    Ok(path.to_string_lossy().into_owned())
}

/// Retorna `%USERPROFILE%\Pictures\FloatingToolbar`, criando se não existir.
fn screenshots_dir(output_dir: Option<String>) -> Result<PathBuf, String> {
    let userprofile = std::env::var("USERPROFILE").map_err(|e| format!("USERPROFILE: {e}"))?;
    let dir = screenshots_dir_from_options(output_dir, &userprofile);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    Ok(dir)
}

fn screenshot_path(dir: PathBuf) -> PathBuf {
    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    dir.join(format!("screenshot-{timestamp}.png"))
}

fn screenshots_dir_from_options(output_dir: Option<String>, userprofile: &str) -> PathBuf {
    match output_dir.map(|value| value.trim().to_string()) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => PathBuf::from(userprofile)
            .join("Pictures")
            .join("FloatingToolbar"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshots_dir_uses_custom_output_dir_when_configured() {
        let dir =
            screenshots_dir_from_options(Some(r"D:\Snapbar\Prints".to_string()), r"C:\Users\Lari");

        assert_eq!(dir, PathBuf::from(r"D:\Snapbar\Prints"));
    }

    #[test]
    fn screenshots_dir_uses_default_pictures_folder_without_custom_dir() {
        let dir = screenshots_dir_from_options(None, r"C:\Users\Lari");

        assert_eq!(
            dir,
            PathBuf::from(r"C:\Users\Lari\Pictures\FloatingToolbar")
        );
    }
}
