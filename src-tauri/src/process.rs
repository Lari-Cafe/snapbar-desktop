use std::{
    path::Path,
    process::{Command, Stdio},
};

pub fn hidden_command(path: &Path) -> Command {
    let mut command = Command::new(path);
    command.stdin(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}
