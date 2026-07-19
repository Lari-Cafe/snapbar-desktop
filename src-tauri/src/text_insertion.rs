#[cfg(windows)]
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

#[cfg(windows)]
static FOCUS_TRACKER_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static LAST_EXTERNAL_HWND: AtomicIsize = AtomicIsize::new(0);

#[cfg(windows)]
pub fn start_focus_tracker() {
    if FOCUS_TRACKER_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    std::thread::spawn(|| loop {
        if let Some(hwnd) = current_external_foreground_window() {
            LAST_EXTERNAL_HWND.store(hwnd, Ordering::SeqCst);
        }
        std::thread::sleep(std::time::Duration::from_millis(120));
    });
}

#[cfg(not(windows))]
pub fn start_focus_tracker() {}

#[cfg(windows)]
pub fn last_external_focus() -> Option<isize> {
    let hwnd = LAST_EXTERNAL_HWND.load(Ordering::SeqCst);
    if hwnd == 0 {
        None
    } else {
        Some(hwnd)
    }
}

#[cfg(not(windows))]
pub fn last_external_focus() -> Option<isize> {
    None
}

pub fn copy_text(text: &str) -> Result<(), String> {
    with_clipboard_retry(|clipboard| {
        clipboard
            .set_text(text.to_string())
            .map_err(|e| format!("clipboard text: {e}"))
    })
}

pub fn restore_last_external_focus() {
    restore_focus(last_external_focus());
}

#[cfg(windows)]
pub fn paste_text_after_backspaces(delete_chars: usize, text: String) -> Result<(), String> {
    use std::{thread, time::Duration};
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_BACK, VK_CONTROL, VK_V};

    thread::sleep(Duration::from_millis(80));
    let previous_clipboard =
        with_clipboard_retry(|clipboard| clipboard.get_text().map_err(|e| e.to_string())).ok();

    copy_text(&text)?;

    unsafe {
        for _ in 0..delete_chars {
            tap_key(VK_BACK);
        }
        key_down_input(VK_CONTROL);
        tap_key(VK_V);
        key_up_input(VK_CONTROL);
    }

    if let Some(previous) = previous_clipboard {
        let restore_delay = clipboard_restore_delay_ms(text.len());
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(restore_delay));
            let _ = copy_text(&previous);
        });
    }

    Ok(())
}

#[cfg(not(windows))]
pub fn paste_text_after_backspaces(_delete_chars: usize, text: String) -> Result<(), String> {
    copy_text(&text)
}

#[cfg(windows)]
fn restore_focus(target_hwnd: Option<isize>) {
    let Some(hwnd) = target_hwnd else {
        return;
    };
    unsafe {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            IsIconic, IsWindow, SetForegroundWindow, ShowWindow, SW_RESTORE,
        };

        let hwnd = HWND(hwnd as *mut std::ffi::c_void);
        if !IsWindow(Some(hwnd)).as_bool() {
            return;
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    }
    std::thread::sleep(std::time::Duration::from_millis(160));
}

#[cfg(not(windows))]
fn restore_focus(_target_hwnd: Option<isize>) {}

fn clipboard_restore_delay_ms(text_len: usize) -> u64 {
    let scaled = 500 + (text_len as u64 / 2);
    scaled.clamp(700, 5_000)
}

fn with_clipboard_retry<T>(
    mut operation: impl FnMut(&mut arboard::Clipboard) -> Result<T, String>,
) -> Result<T, String> {
    let mut last_error = None;
    for _ in 0..5 {
        match arboard::Clipboard::new() {
            Ok(mut clipboard) => match operation(&mut clipboard) {
                Ok(value) => return Ok(value),
                Err(err) => last_error = Some(err),
            },
            Err(err) => last_error = Some(format!("clipboard: {err}")),
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    }

    Err(last_error.unwrap_or_else(|| "clipboard indisponivel".to_string()))
}

#[cfg(windows)]
fn current_external_foreground_window() -> Option<isize> {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId, IsWindowVisible,
        };

        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() || !IsWindowVisible(hwnd).as_bool() {
            return None;
        }
        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id == std::process::id() {
            return None;
        }
        Some(hwnd.0 as isize)
    }
}

#[cfg(windows)]
unsafe fn tap_key(key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) {
    key_down_input(key);
    key_up_input(key);
}

#[cfg(windows)]
unsafe fn key_down_input(key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) {
    send_key_input(key, false);
}

#[cfg(windows)]
unsafe fn key_up_input(key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) {
    send_key_input(key, true);
}

#[cfg(windows)]
unsafe fn send_key_input(
    key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
    key_up: bool,
) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    };

    let flags = if key_up {
        KEYEVENTF_KEYUP
    } else {
        Default::default()
    };
    let input = INPUT {
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
    };
    let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_restore_delay_scales_for_large_text() {
        assert_eq!(clipboard_restore_delay_ms(10), 700);
        assert!(clipboard_restore_delay_ms(10_000) >= 5_000);
    }
}
