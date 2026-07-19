use serde::Serialize;

const VOICE_TYPING_FAILURE_MESSAGE: &str =
    "Ditado do Windows nao abriu. Tente novamente no app ativo.";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowsVoiceTypingStatus {
    pub triggered: bool,
    pub warning: Option<String>,
}

#[tauri::command]
pub fn toggle_windows_voice_typing() -> Result<WindowsVoiceTypingStatus, String> {
    crate::text_insertion::restore_last_external_focus();
    platform_toggle_windows_voice_typing()?;
    Ok(WindowsVoiceTypingStatus {
        triggered: true,
        warning: None,
    })
}

#[cfg(windows)]
fn platform_toggle_windows_voice_typing() -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_LWIN,
    };

    const VK_H: VIRTUAL_KEY = VIRTUAL_KEY(0x48);

    unsafe fn key_input(key: VIRTUAL_KEY, key_up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: if key_up {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    let inputs = unsafe {
        [
            key_input(VK_LWIN, false),
            key_input(VK_H, false),
            key_input(VK_H, true),
            key_input(VK_LWIN, true),
        ]
    };
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err(VOICE_TYPING_FAILURE_MESSAGE.to_string())
    }
}

#[cfg(not(windows))]
fn platform_toggle_windows_voice_typing() -> Result<(), String> {
    Err("Digitacao por voz do Windows indisponivel neste sistema.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_typing_failure_message_stays_user_facing() {
        assert!(VOICE_TYPING_FAILURE_MESSAGE.contains("Ditado do Windows nao abriu"));
        assert!(!VOICE_TYPING_FAILURE_MESSAGE
            .to_ascii_lowercase()
            .contains("sendinput"));
    }
}
