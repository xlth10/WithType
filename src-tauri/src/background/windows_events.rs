//! Native power/session messages are received even when the settings window is hidden.
use std::{ptr, thread};
use tauri::AppHandle;
use windows_sys::Win32::{
    Foundation::{GetLastError, HWND, LPARAM, LRESULT, WPARAM},
    System::{
        LibraryLoader::GetModuleHandleW,
        RemoteDesktop::{
            WTSRegisterSessionNotification, WTSUnRegisterSessionNotification,
            NOTIFY_FOR_THIS_SESSION,
        },
    },
    UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
        GetWindowLongPtrW, KillTimer, PostQuitMessage, RegisterClassW, SetTimer, SetWindowLongPtrW,
        TranslateMessage, CREATESTRUCTW, GWLP_USERDATA, MSG, PBT_APMRESUMEAUTOMATIC,
        PBT_APMRESUMESUSPEND, PBT_APMSUSPEND, WM_DESTROY, WM_ENDSESSION, WM_NCCREATE,
        WM_POWERBROADCAST, WM_TIMER, WM_WTSSESSION_CHANGE, WNDCLASSW,
    },
};

unsafe extern "system" fn procedure(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        let create = &*(lparam as *const CREATESTRUCTW);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
    }
    let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const AppHandle;
    if let Some(app) = pointer.as_ref() {
        match message {
            WM_POWERBROADCAST => {
                match wparam as u32 {
                    PBT_APMSUSPEND => super::system_pause(app, true, true),
                    PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => {
                        super::system_pause(app, true, false)
                    }
                    _ => {}
                }
                return 1;
            }
            WM_WTSSESSION_CHANGE => match wparam {
                7 => super::system_pause(app, false, true), // WTS_SESSION_LOCK
                8 => super::system_pause(app, false, false), // WTS_SESSION_UNLOCK
                _ => {}
            },
            WM_ENDSESSION if wparam != 0 => super::stop(app),
            WM_DESTROY => {
                PostQuitMessage(0);
                return 0;
            }
            _ => {}
        }
    }
    DefWindowProcW(hwnd, message, wparam, lparam)
}

pub fn start(app: AppHandle) {
    thread::spawn(move || unsafe {
        let class: Vec<u16> = "WithTypeBackgroundEvents\0".encode_utf16().collect();
        let instance = GetModuleHandleW(ptr::null());
        let window_class = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            ..std::mem::zeroed()
        };
        if RegisterClassW(&window_class) == 0 {
            eprintln!(
                "WithType system event registration failed: {}",
                GetLastError()
            );
            return;
        }
        // This AppHandle remains at a stable stack address until the loop ends.
        let hwnd = CreateWindowExW(
            0,
            class.as_ptr(),
            class.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            instance,
            &app as *const AppHandle as *const _,
        );
        if hwnd.is_null() {
            eprintln!("WithType system event window failed: {}", GetLastError());
            return;
        }
        let mut registered = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) != 0;
        if !registered {
            eprintln!(
                "WithType session notifications unavailable; retrying: {}",
                GetLastError()
            );
            SetTimer(hwnd, 1, 5000, None);
        }
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, ptr::null_mut(), 0, 0) > 0 {
            // Terminal Services can still be starting during login auto-launch.
            if message.message == WM_TIMER && message.wParam == 1 && !registered {
                registered = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) != 0;
                if registered {
                    KillTimer(hwnd, 1);
                }
                continue;
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if registered {
            WTSUnRegisterSessionNotification(hwnd);
        }
        KillTimer(hwnd, 1);
        DestroyWindow(hwnd);
    });
}
