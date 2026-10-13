use super::*;
use crate::{card_position::Rect, uia::FocusedField};
use std::{
    sync::mpsc::{self, Sender, SyncSender},
    thread,
    time::{Duration, Instant},
};
use windows::Win32::UI::Accessibility::IUIAutomationTextRange;
use windows_sys::Win32::{
    Foundation::POINT,
    Graphics::Gdi::ClientToScreen,
    System::DataExchange::GetClipboardSequenceNumber,
    UI::{
        HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
            KEYEVENTF_KEYUP, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
        },
        WindowsAndMessaging::{
            GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO,
        },
    },
};

#[derive(Clone, Copy, PartialEq)]
struct Focus {
    window: isize,
    child: isize,
    pid: u32,
}
fn focus() -> Option<Focus> {
    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return None;
        }
        let mut pid = 0;
        let tid = GetWindowThreadProcessId(window, &mut pid);
        if pid == std::process::id() {
            return None;
        }
        let mut info: GUITHREADINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        if GetGUIThreadInfo(tid, &mut info) == 0 {
            return None;
        }
        Some(Focus {
            window: window as isize,
            child: info.hwndFocus as isize,
            pid,
        })
    }
}

fn system_caret() -> Option<Rect> {
    unsafe {
        struct DpiGuard(*mut core::ffi::c_void);
        impl Drop for DpiGuard {
            fn drop(&mut self) {
                unsafe {
                    if !self.0.is_null() {
                        SetThreadDpiAwarenessContext(self.0);
                    }
                }
            }
        }
        let _dpi = DpiGuard(SetThreadDpiAwarenessContext(
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        ));
        focus()?;
        let mut info: GUITHREADINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        if GetGUIThreadInfo(0, &mut info) == 0 || info.hwndCaret.is_null() {
            return None;
        }
        let r = info.rcCaret;
        if r.bottom <= r.top || r.right < r.left {
            return None;
        }
        let mut point = POINT {
            x: r.left,
            y: r.top,
        };
        if ClientToScreen(info.hwndCaret, &mut point) == 0 {
            return None;
        }
        Some(Rect {
            x: point.x,
            y: point.y,
            width: (r.right - r.left).max(1),
            height: r.bottom - r.top,
        })
    }
}

struct Target {
    focus: Option<Focus>,
    field: Option<FocusedField>,
    before: Option<String>,
    selection: Option<IUIAutomationTextRange>,
    clipboard_seq: u32,
}
impl Target {
    fn capture(clipboard_seq: u32, start: Option<Focus>) -> Self {
        let field = if start.is_some() && focus() == start {
            FocusedField::capture()
        } else {
            None
        };
        let before = field.as_ref().and_then(|f| f.read());
        let selection = field.as_ref().and_then(|f| f.selection_range());
        let field = if focus() == start { field } else { None };
        Self {
            focus: start,
            field,
            before,
            selection,
            clipboard_seq,
        }
    }
    fn valid(&self) -> bool {
        self.focus.is_some()
            && self.focus == focus()
            && self.field.as_ref().is_some_and(|f| {
                f.is_focused()
                    && f.writable()
                    && self
                        .selection
                        .as_ref()
                        .map_or(true, |r| f.selection_matches(r))
                    && self
                        .before
                        .as_ref()
                        .map_or(true, |before| f.read().as_ref() == Some(before))
            })
    }
}

enum Request {
    Capture {
        id: String,
        flag: Arc<AtomicBool>,
        expires: Instant,
        clipboard_seq: u32,
        start: Option<Focus>,
        response: Sender<Result<(), String>>,
    },
    Deliver {
        text: String,
        id: String,
        paste: bool,
        flag: Arc<AtomicBool>,
        copied: Arc<AtomicBool>,
        app: tauri::AppHandle,
        learn: bool,
        response: Sender<Result<Delivery, String>>,
    },
    Caret {
        response: Sender<Option<Rect>>,
    },
}
fn worker() -> Result<&'static SyncSender<Request>, String> {
    static WORKER: OnceLock<Result<SyncSender<Request>, String>> = OnceLock::new();
    WORKER
        .get_or_init(|| {
            let (tx, rx) = mpsc::sync_channel(8);
            thread::Builder::new()
                .name("input-delivery".into())
                .spawn(move || {
                    // Native caret coordinates and monitor work areas use physical pixels.
                    unsafe {
                        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                    }
                    let mut targets = HashMap::<String, Target>::new();
                    let mut order = VecDeque::new();
                    while let Ok(request) = rx.recv() {
                        match request {
                            Request::Capture {
                                id,
                                flag,
                                expires,
                                clipboard_seq,
                                start,
                                response,
                            } => {
                                let mut target = Target::capture(clipboard_seq, start);
                                let expired = Instant::now() >= expires;
                                if !flag.load(Ordering::SeqCst) {
                                    if expired {
                                        // Keep the early clipboard baseline, but never
                                        // authorize input using a late target capture.
                                        target.focus = None;
                                        target.field = None;
                                        target.before = None;
                                        target.selection = None;
                                    }
                                    targets.insert(id.clone(), target);
                                    order.push_back(id);
                                    while order.len() > 64 {
                                        if let Some(old) = order.pop_front() {
                                            targets.remove(&old);
                                        }
                                    }
                                    let _ = response.send(if expired {
                                        Err("输入目标检查超时，本次仅保留结果".into())
                                    } else {
                                        Ok(())
                                    });
                                } else {
                                    let _ = response.send(Err("输入已取消".into()));
                                }
                            }
                            Request::Caret { response } => {
                                let caret = FocusedField::capture()
                                    .and_then(|f| f.caret())
                                    .or_else(system_caret);
                                let _ = response.send(caret);
                            }
                            Request::Deliver {
                                text,
                                id,
                                paste,
                                flag,
                                copied,
                                app,
                                learn,
                                response,
                            } => {
                                let result = perform(
                                    text,
                                    &id,
                                    targets.remove(&id),
                                    paste,
                                    &flag,
                                    &copied,
                                    app,
                                    learn,
                                );
                                let _ = response.send(result);
                            }
                        }
                    }
                })
                .map_err(|e| e.to_string())?;
            Ok(tx)
        })
        .as_ref()
        .map_err(Clone::clone)
}
pub(super) fn capture(id: String, flag: Arc<AtomicBool>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    worker()?
        .try_send(Request::Capture {
            id,
            flag,
            expires: Instant::now() + Duration::from_millis(600),
            clipboard_seq: unsafe { GetClipboardSequenceNumber() },
            start: focus(),
            response: tx,
        })
        .map_err(|_| "输入目标检查繁忙")?;
    match rx.recv_timeout(Duration::from_millis(600)) {
        Ok(result) => result,
        Err(_) => Err("输入目标检查超时，本次仅保留结果".into()),
    }
}
pub(super) fn deliver(
    text: String,
    id: String,
    paste: bool,
    flag: Arc<AtomicBool>,
    app: tauri::AppHandle,
    learn: bool,
) -> Result<Delivery, String> {
    let (tx, rx) = mpsc::channel();
    let copied = Arc::new(AtomicBool::new(false));
    worker()?
        .try_send(Request::Deliver {
            text,
            id,
            paste,
            flag: flag.clone(),
            copied: copied.clone(),
            app,
            learn,
            response: tx,
        })
        .map_err(|_| "输入投递繁忙，结果已保留")?;
    match rx.recv_timeout(Duration::from_secs(4)) {
        Ok(result) => result,
        Err(_) => {
            flag.store(true, Ordering::SeqCst);
            let mut result = Delivery::retained("输入尚未确认，结果已保留，请手动复制");
            // Preserve an already committed result even if cancellation makes
            // the frontend stale while an accessibility provider is blocked.
            result.copied = copied.load(Ordering::SeqCst);
            Ok(result)
        }
    }
}
pub(super) fn caret() -> Option<Rect> {
    let fallback = system_caret();
    let (tx, rx) = mpsc::channel();
    if worker()
        .ok()
        .is_none_or(|w| w.try_send(Request::Caret { response: tx }).is_err())
    {
        return fallback;
    }
    rx.recv_timeout(Duration::from_millis(250))
        .ok()
        .flatten()
        .or(fallback)
}

fn perform(
    text: String,
    id: &str,
    target: Option<Target>,
    paste: bool,
    flag: &AtomicBool,
    copied: &AtomicBool,
    app: tauri::AppHandle,
    learn: bool,
) -> Result<Delivery, String> {
    if flag.load(Ordering::SeqCst) {
        return Err("输入已取消".into());
    }
    let requested_paste = paste;
    let mut paste = paste && target.as_ref().is_some_and(Target::valid);
    let mut reason = if !requested_paste {
        "已复制，可以粘贴"
    } else if paste {
        ""
    } else {
        "没有可用输入位置，已复制，可以粘贴"
    };
    let until = Instant::now() + Duration::from_millis(500);
    while paste && modifiers_pressed() {
        if flag.load(Ordering::SeqCst) {
            return Err("输入已取消".into());
        }
        if Instant::now() >= until {
            paste = false;
            reason = "快捷键尚未松开，已复制，可以粘贴";
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    if paste && !target.as_ref().is_some_and(Target::valid) {
        paste = false;
        reason = "输入位置已变化，已复制，可以粘贴";
    }
    if flag.load(Ordering::SeqCst) {
        return Err("输入已取消".into());
    }
    if target
        .as_ref()
        .is_some_and(|t| unsafe { GetClipboardSequenceNumber() } != t.clipboard_seq)
    {
        return Ok(Delivery::retained(
            "剪贴板已被更新，保留了新复制的内容；语音结果可在卡片中复制",
        ));
    }
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            return Ok(Delivery::retained(format!(
                "无法打开剪贴板，结果已保留：{e}"
            )))
        }
    };
    if flag.load(Ordering::SeqCst) {
        return Err("输入已取消".into());
    }
    if let Err(e) = clipboard.set_text(text.clone()) {
        return Ok(Delivery::retained(format!("复制失败，结果已保留：{e}")));
    }
    copied.store(true, Ordering::SeqCst);
    let sequence = unsafe { GetClipboardSequenceNumber() };
    if !paste {
        return Ok(Delivery::copied(if reason.is_empty() {
            "已复制，可以粘贴"
        } else {
            reason
        }));
    }
    if flag.load(Ordering::SeqCst) {
        return Ok(Delivery::copied("输入已取消，正文已复制"));
    }
    // Check once more immediately before sending; never restore clipboard later.
    if target.as_ref().is_none_or(|t| t.focus != focus()) || modifiers_pressed() {
        return Ok(Delivery::copied(
            "输入位置或按键状态已变化，已复制，可以粘贴",
        ));
    }
    if unsafe { GetClipboardSequenceNumber() } != sequence {
        let mut result = Delivery::retained("剪贴板已更新，未发送粘贴；语音结果已保留");
        result.copied = true;
        return Ok(result);
    }
    crate::correction_monitor::stop_learning_monitor();
    let monitor = if learn && crate::correction_monitor::is_enabled() {
        crate::correction_monitor::prepare(app, text.clone(), id.to_owned())
    } else {
        None
    };
    // prepare can await an accessibility provider: recheck after that wait.
    let valid = target.as_ref().is_some_and(Target::valid);
    let same_clipboard = unsafe { GetClipboardSequenceNumber() } == sequence;
    let can_send = valid && !flag.load(Ordering::SeqCst) && !modifiers_pressed() && same_clipboard;
    let sent = can_send && send_ctrl_v();
    if let Some(m) = monitor {
        let _ = m.send(sent);
    }
    if !same_clipboard {
        let mut result = Delivery::retained("剪贴板已更新，未发送粘贴；语音结果已保留");
        result.copied = true;
        return Ok(result);
    }
    if !sent {
        return Ok(Delivery::copied("自动输入未完成，正文已复制，可以粘贴"));
    }
    thread::sleep(Duration::from_millis(150));
    let verified = target.as_ref().is_some_and(|t| {
        t.focus == focus()
            && t.field.as_ref().is_some_and(|f| {
                f.is_focused()
                    && t.before
                        .as_ref()
                        .zip(f.read().as_ref())
                        .is_some_and(|(before, after)| {
                            crate::correction_monitor::insertion_confirmed(before, after, &text)
                        })
            })
    });
    let clipboard_unchanged = unsafe { GetClipboardSequenceNumber() } == sequence;
    Ok(Delivery {
        status: if verified { "inserted" } else { "sent" }.into(),
        copied: true,
        pasted: verified,
        message: match (verified, clipboard_unchanged) {
            (true, true) => "已输入，正文保留在剪贴板",
            (true, false) => "已输入；剪贴板已更新，正文可从历史取回",
            (false, true) => "已发送粘贴，未确认输入；正文保留在剪贴板",
            (false, false) => "已发送粘贴，未确认输入；剪贴板已更新，正文已保留",
        }
        .into(),
    })
}
fn modifiers_pressed() -> bool {
    [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
        .iter()
        .any(|key| unsafe { GetAsyncKeyState(*key as i32) } < 0)
}
fn send_ctrl_v() -> bool {
    fn key(vk: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
    let inputs = [
        key(VK_CONTROL, 0),
        key(0x56, 0),
        key(0x56, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    unsafe {
        let sent = SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
        if sent > 0 && sent < inputs.len() as u32 {
            let releases = [key(0x56, KEYEVENTF_KEYUP), key(VK_CONTROL, KEYEVENTF_KEYUP)];
            SendInput(
                releases.len() as u32,
                releases.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            );
        }
        sent == inputs.len() as u32
    }
}
