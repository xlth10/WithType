//! Show the voice HUD without taking the target application's keyboard focus.
use windows_sys::Win32::{
    Foundation::{GetLastError, SetLastError, HWND},
    UI::WindowsAndMessaging::{
        GetWindowLongPtrW, IsIconic, IsWindow, SetWindowLongPtrW, ShowWindow, GWL_EXSTYLE,
        SW_SHOWNA, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE,
    },
};

pub(crate) fn configure(handle: isize) -> Result<(), String> {
    unsafe {
        let hwnd = handle as HWND;
        if IsWindow(hwnd) == 0 {
            return Err("悬浮窗已关闭".into());
        }
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetLastError(0);
        let previous = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE as isize);
        if previous == 0 && GetLastError() != 0 {
            return Err("无法配置悬浮窗焦点".into());
        }
        Ok(())
    }
}

pub(crate) fn show(handle: isize) -> Result<(), String> {
    configure(handle)?;
    // ShowWindow returns prior visibility; zero is not a failure indication.
    unsafe {
        let hwnd = handle as HWND;
        let command = if IsIconic(hwnd) != 0 {
            SW_SHOWNOACTIVATE
        } else {
            SW_SHOWNA
        };
        ShowWindow(hwnd, command);
    }
    Ok(())
}
