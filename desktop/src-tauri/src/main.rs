// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // stolen from https://github.com/tauri-apps/tauri/issues/8305#issuecomment-1826871949
    #[cfg(windows)]
    {
        use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
        // we ignore the result here because
        // if the app started from a command line, like cmd or powershell,
        // it will attach sucessfully which is what we want
        // but if we were started from something like explorer,
        // it will fail to attach console which is also what we want.
        let _ = unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
    }
    transcribee_desktop_lib::run()
}
