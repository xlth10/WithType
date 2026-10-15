use super::policy::{self, Editability, TextWitness};
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
        if tid == 0 || pid == 0 {
            return None;
        }
        let mut info: GUITHREADINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        let has_info = GetGUIThreadInfo(tid, &mut info) != 0;
        Some(Focus {
            window: window as isize,
            child: if has_info { info.hwndFocus as isize } else { 0 },
            pid,
        })
    }
}
impl Focus {
    fn matches(self, now: Self) -> bool {
        self.window == now.window
            && self.pid == now.pid
            && (self.child == now.child || self.child == 0 || now.child == 0)
    }
    fn hwnd(self) -> isize {
        if self.child != 0 {
            self.child
        } else {
            self.window
        }
    }
}
fn same_focus(initial: Option<Focus>) -> bool {
    initial.zip(focus()).is_some_and(|(a, b)| a.matches(b))
}

const CAPTURE_BUDGET: Duration = Duration::from_millis(1200);
const TARGET_WAIT: Duration = Duration::from_millis(1800);

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
        if focus()?.pid == std::process::id() {
            return None;
        }
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
    before: Option<String>,
    // Release saved ranges before FocusedField drops its COM apartment.
    selection: Option<IUIAutomationTextRange>,
    field: Option<FocusedField>,
    witness: Option<TextWitness>,
    clipboard_seq: u32,
    capture: CaptureInfo,
    created: Instant,
}
impl Target {
    fn capture(
        clipboard_seq: u32,
        start: Option<Focus>,
        created: Instant,
        expires: Instant,
    ) -> Self {
        let started = Instant::now();
        let mut reason = Reason::Ready;
        let mut identity = start.map(|focus| TargetIdentity {
            window: focus.window,
            child: focus.child,
            process_id: focus.pid,
            focus_source: None,
            text_source: None,
            hresult: None,
        });
        let mut field = if Instant::now() >= expires {
            reason = Reason::CaptureTimeout;
            None
        } else if let Some(initial) = start {
            if initial.pid == std::process::id() {
                reason = Reason::OwnProcess;
                None
            } else if !same_focus(start) {
                reason = Reason::FocusChanged;
                None
            } else {
                match FocusedField::capture_from(Some(initial.hwnd()), Some(initial.pid), expires) {
                    Ok(field) => {
                        if let Some(identity) = &mut identity {
                            identity.focus_source = Some(field.focus_source);
                            identity.text_source = Some(field.text_source);
                        }
                        Some(field)
                    }
                    Err(error) => {
                        reason = error.reason;
                        if let Some(identity) = &mut identity {
                            identity.hresult = error.hresult;
                        }
                        None
                    }
                }
            }
        } else {
            reason = Reason::NoFocus;
            None
        };
        let mut selection = field
            .as_ref()
            .filter(|_| Instant::now() < expires)
            .and_then(|f| f.selection_range());
        let witness = field
            .as_ref()
            .filter(|_| Instant::now() < expires)
            .and_then(|f| f.witness(256));
        let before = if witness.is_none() {
            field
                .as_ref()
                .filter(|_| Instant::now() < expires)
                .and_then(|f| f.read())
        } else {
            None
        };
        if let Some(f) = field.as_ref().filter(|_| Instant::now() < expires) {
            reason = match f.editability() {
                Editability::Writable => Reason::Ready,
                Editability::ReadOnly => Reason::ReadOnly,
                Editability::Unknown
                    if selection.is_some()
                        && (witness.is_some() || before.is_some())
                        && f.compatible_edit() =>
                {
                    Reason::Compatibility
                }
                Editability::Unknown => Reason::ProviderUnsupported,
            };
        }
        if Instant::now() >= expires {
            reason = Reason::CaptureTimeout;
            selection = None;
            field = None;
        } else if start.is_some() && !same_focus(start) {
            reason = Reason::FocusChanged;
            selection = None;
            field = None;
        }
        let mut capture = CaptureInfo::new(reason, started.elapsed().as_millis() as u64);
        capture.queue_ms = started.saturating_duration_since(created).as_millis() as u64;
        capture.target = identity;
        Self {
            focus: start,
            field,
            before,
            selection,
            witness,
            clipboard_seq,
            capture,
            created,
        }
    }
    fn missing() -> Self {
        Self {
            focus: None,
            field: None,
            before: None,
            selection: None,
            witness: None,
            clipboard_seq: unsafe { GetClipboardSequenceNumber() },
            capture: CaptureInfo::new(Reason::CaptureMissing, 0),
            created: Instant::now(),
        }
    }
    fn validate(&mut self) -> Result<(), Reason> {
        if self.field.is_none() {
            return Err(self.capture.reason);
        }
        if !same_focus(self.focus) {
            return Err(Reason::FocusChanged);
        }
        let field = self.field.as_mut().ok_or(Reason::ProviderUnsupported)?;
        if !field.is_focused() && !field.rebind_native_edit() {
            return Err(Reason::FocusChanged);
        }
        field.guarded()?;
        if !field.enabled() {
            return Err(Reason::TargetDisabled);
        }
        let editable = field.editability();
        if !policy::may_paste(
            editable,
            editable == Editability::Unknown
                && self.selection.is_some()
                && (self.witness.is_some() || self.before.is_some())
                && field.compatible_edit(),
        ) {
            return Err(if editable == Editability::ReadOnly {
                Reason::ReadOnly
            } else {
                Reason::ProviderUnsupported
            });
        }
        if self
            .selection
            .as_ref()
            .is_some_and(|range| !field.selection_matches(range))
        {
            return Err(Reason::SelectionChanged);
        }
        if let Some(witness) = &self.witness {
            if field.witness(256).as_ref() != Some(witness) {
                return Err(Reason::ContentChanged);
            }
        } else if self
            .before
            .as_ref()
            .is_some_and(|text| field.read().as_ref() != Some(text))
        {
            return Err(Reason::ContentChanged);
        }
        if !same_focus(self.focus) {
            return Err(Reason::FocusChanged);
        }
        Ok(())
    }
    fn confirms(&self, text: &str) -> bool {
        if !same_focus(self.focus) {
            return false;
        }
        let Some(field) = self
            .field
            .as_ref()
            .filter(|f| f.is_focused() && f.guarded().is_ok())
        else {
            return false;
        };
        if let Some(before) = &self.witness {
            let radius = text.encode_utf16().count().saturating_add(256);
            return field
                .witness(radius)
                .is_some_and(|now| before.confirms(&now, text));
        }
        self.before
            .as_ref()
            .zip(field.read().as_ref())
            .is_some_and(|(before, after)| {
                crate::correction_monitor::insertion_confirmed(before, after, text)
                    || crate::correction_monitor::insertion_confirmed(
                        &policy::comparable_lines(before),
                        &policy::comparable_lines(after),
                        &policy::comparable_lines(text),
                    )
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
        created: Instant,
        response: Option<Sender<Result<CaptureInfo, String>>>,
    },
    Adopt {
        id: String,
        input_token: String,
        flag: Arc<AtomicBool>,
        response: Sender<Result<CaptureInfo, String>>,
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
                                created,
                            } => {
                                let target =
                                    Target::capture(clipboard_seq, start, created, expires);
                                crate::debug_log(&format!(
                                    "input capture: native_focus={} uia={} readable={} selection={} reason={:?}",
                                    target.focus.is_some(), target.field.is_some(),
                                    target.before.is_some() || target.witness.is_some(),
                                    target.selection.is_some(), target.capture.reason,
                                ));
                                if !flag.load(Ordering::SeqCst) {
                                    let receipt = target.capture.clone();
                                    record_target(
                                        &id,
                                        "capture",
                                        receipt.reason,
                                        receipt.elapsed_ms + receipt.queue_ms,
                                        Some(0),
                                        receipt.target.clone(),
                                    );
                                    targets.insert(id.clone(), target);
                                    order.push_back(id);
                                    while order.len() > 64 {
                                        if let Some(old) = order.pop_front() {
                                            targets.remove(&old);
                                        }
                                    }
                                    if let Some(response) = response {
                                        let _ = response.send(Ok(receipt));
                                    }
                                } else if let Some(response) = response {
                                    let _ = response.send(Err("输入已取消".into()));
                                }
                            }
                            Request::Adopt {
                                id,
                                input_token,
                                flag,
                                response,
                            } => {
                                let target = targets
                                    .remove(&input_token)
                                    .filter(|t| t.created.elapsed() <= Duration::from_secs(5))
                                    .unwrap_or_else(Target::missing);
                                if flag.load(Ordering::SeqCst) {
                                    let _ = response.send(Err("输入已取消".into()));
                                    continue;
                                }
                                let receipt = target.capture.clone();
                                targets.insert(id.clone(), target);
                                order.push_back(id.clone());
                                while order.len() > 64 {
                                    if let Some(old) = order.pop_front() {
                                        targets.remove(&old);
                                    }
                                }
                                record_target(
                                    &id,
                                    "adopt",
                                    receipt.reason,
                                    receipt.elapsed_ms + receipt.queue_ms,
                                    Some(0),
                                    receipt.target.clone(),
                                );
                                let _ = response.send(Ok(receipt));
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
pub(super) fn prime(id: String, flag: Arc<AtomicBool>) {
    let created = Instant::now();
    let request = Request::Capture {
        id: id.clone(),
        flag,
        expires: created + CAPTURE_BUDGET,
        clipboard_seq: unsafe { GetClipboardSequenceNumber() },
        start: focus(),
        created,
        response: None,
    };
    if worker()
        .and_then(|worker| {
            worker
                .try_send(request)
                .map_err(|_| "输入位置检查繁忙".into())
        })
        .is_err()
    {
        record(&id, "prime", Reason::CaptureBusy, 0, 0);
    }
}

pub(super) fn capture(
    id: String,
    flag: Arc<AtomicBool>,
    input_token: Option<String>,
) -> Result<CaptureInfo, String> {
    let (tx, rx) = mpsc::channel();
    let created = Instant::now();
    let diagnostic_id = id.clone();
    let request = if let Some(input_token) = input_token {
        Request::Adopt {
            id,
            input_token,
            flag,
            response: tx,
        }
    } else {
        Request::Capture {
            id,
            flag,
            expires: created + CAPTURE_BUDGET,
            clipboard_seq: unsafe { GetClipboardSequenceNumber() },
            start: focus(),
            created,
            response: Some(tx),
        }
    };
    if worker()?.try_send(request).is_err() {
        record(&diagnostic_id, "capture", Reason::CaptureBusy, 0, 0);
        return Ok(CaptureInfo::new(Reason::CaptureBusy, 0));
    }
    match rx.recv_timeout(TARGET_WAIT) {
        Ok(result) => result,
        Err(_) => {
            record(
                &diagnostic_id,
                "capture",
                Reason::CaptureTimeout,
                TARGET_WAIT.as_millis() as u64,
                0,
            );
            Ok(CaptureInfo::new(
                Reason::CaptureTimeout,
                TARGET_WAIT.as_millis() as u64,
            ))
        }
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
    let diagnostic_id = id.clone();
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
            // A blocked provider may be after SendInput; its event count is
            // unavailable here, rather than evidence that nothing was sent.
            record_target(
                &diagnostic_id,
                "delivery",
                Reason::DeliveryTimeout,
                4000,
                None,
                None,
            );
            let mut result = Delivery::retained("输入尚未确认，结果已保留，请手动复制");
            // Preserve an already committed result even if cancellation makes
            // the frontend stale while an accessibility provider is blocked.
            result.copied = copied.load(Ordering::SeqCst);
            result.reason = Reason::DeliveryTimeout;
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

fn copied_for(reason: Reason) -> Delivery {
    let mut result = Delivery::copied(if reason == Reason::CopyRequested {
        reason.message().into()
    } else {
        format!("{}，正文已复制，可以粘贴", reason.message())
    });
    result.reason = reason;
    result
}
fn retained_for(reason: Reason) -> Delivery {
    let mut result = Delivery::retained(format!(
        "{}；语音结果已保留，可在卡片中复制",
        reason.message()
    ));
    result.reason = reason;
    result
}

fn perform(
    text: String,
    id: &str,
    mut target: Option<Target>,
    paste: bool,
    flag: &AtomicBool,
    copied: &AtomicBool,
    app: tauri::AppHandle,
    learn: bool,
) -> Result<Delivery, String> {
    let started = Instant::now();
    let mut diagnostics = DeliveryDiagnostics {
        capture_ms: target.as_ref().map_or(0, |t| t.capture.elapsed_ms),
        capture_queue_ms: target.as_ref().map_or(0, |t| t.capture.queue_ms),
        target: target.as_ref().and_then(|t| t.capture.target.clone()),
        ..Default::default()
    };
    let result = (|| {
        if flag.load(Ordering::SeqCst) {
            return Err("输入已取消".into());
        }
        if paste
            && target
                .as_ref()
                .is_none_or(|t| t.capture.reason == Reason::CaptureMissing)
        {
            return Ok(retained_for(Reason::CaptureMissing));
        }
        let mut reason = if paste {
            target
                .as_mut()
                .map_or(Err(Reason::CaptureMissing), Target::validate)
                .err()
        } else {
            Some(Reason::CopyRequested)
        };
        let until = Instant::now() + Duration::from_millis(500);
        while paste && reason.is_none() && modifiers_pressed() {
            if flag.load(Ordering::SeqCst) {
                return Err("输入已取消".into());
            }
            if Instant::now() >= until {
                reason = Some(Reason::ModifiersHeld);
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        if flag.load(Ordering::SeqCst) {
            return Err("输入已取消".into());
        }
        use tauri::Manager;
        let owner = app
            .get_webview_window("main")
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as windows_sys::Win32::Foundation::HWND)
            .unwrap_or(std::ptr::null_mut());
        // Check the original sequence while OpenClipboard excludes other writers.
        let sequence =
            match write_clipboard(&text, owner, target.as_ref().map(|t| t.clipboard_seq), flag) {
                Ok(sequence) => sequence,
                Err(error) => return Ok(retained_for(error)),
            };
        copied.store(true, Ordering::SeqCst);
        if let Some(reason) = reason {
            return Ok(copied_for(reason));
        }
        if flag.load(Ordering::SeqCst) {
            return Ok(copied_for(Reason::Cancelled));
        }
        crate::correction_monitor::stop_learning_monitor();
        let monitor = if learn && crate::correction_monitor::is_enabled() {
            crate::correction_monitor::prepare(app, text.clone(), id.to_owned())
        } else {
            None
        };
        // Learning setup may wait on another provider. This is the final complete
        // target check, followed by cheap OS checks immediately before injection.
        let check = target
            .as_mut()
            .map_or(Err(Reason::CaptureMissing), Target::validate);
        let same_clipboard = unsafe { GetClipboardSequenceNumber() } == sequence;
        let reason = if !same_clipboard {
            Some(Reason::ClipboardChanged)
        } else if flag.load(Ordering::SeqCst) {
            Some(Reason::Cancelled)
        } else if !same_focus(target.as_ref().and_then(|t| t.focus)) {
            Some(Reason::FocusChanged)
        } else if modifiers_pressed() {
            Some(Reason::ModifiersHeld)
        } else {
            check.err()
        };
        if reason.is_none() {
            diagnostics.sent_events = send_ctrl_v();
        }
        let sent = diagnostics.sent_events == 4;
        if let Some(monitor) = monitor {
            let _ = monitor.send(sent);
        }
        if let Some(reason) = reason {
            if reason == Reason::ClipboardChanged {
                let mut result = retained_for(reason);
                result.copied = true;
                return Ok(result);
            }
            return Ok(copied_for(reason));
        }
        if !sent {
            return Ok(copied_for(Reason::SendFailed));
        }
        let verify = Instant::now();
        let mut verified = false;
        // Retry observation only. Never repeat Ctrl+V after an unconfirmed send.
        for wait in [60, 100, 180, 260] {
            if flag.load(Ordering::SeqCst) || verify.elapsed() >= Duration::from_millis(900) {
                break;
            }
            thread::sleep(Duration::from_millis(wait));
            if flag.load(Ordering::SeqCst) || verify.elapsed() >= Duration::from_millis(900) {
                break;
            }
            if target.as_ref().is_some_and(|t| t.confirms(&text)) {
                verified = true;
                break;
            }
            if !same_focus(target.as_ref().and_then(|t| t.focus)) {
                break;
            }
        }
        diagnostics.verify_ms = verify.elapsed().as_millis() as u64;
        let clipboard_unchanged = unsafe { GetClipboardSequenceNumber() } == sequence;
        Ok(Delivery {
            status: if verified { "inserted" } else { "sent" }.into(),
            copied: true,
            pasted: verified,
            reason: if verified {
                Reason::Inserted
            } else {
                Reason::SentUnverified
            },
            diagnostics: None,
            message: match (verified, clipboard_unchanged) {
                (true, true) => "已输入，正文保留在剪贴板",
                (true, false) => "已输入；剪贴板已更新，正文可从历史取回",
                (false, true) => "已发送粘贴，未确认输入；正文保留在剪贴板",
                (false, false) => "已发送粘贴，未确认输入；剪贴板已更新，正文已保留",
            }
            .into(),
        })
    })();
    match result {
        Ok(mut result) => {
            crate::debug_log(&format!(
                "input delivery: status={} reason={:?} sent_events={}",
                result.status, result.reason, diagnostics.sent_events,
            ));
            record_target(
                id,
                "delivery",
                result.reason,
                started.elapsed().as_millis() as u64,
                Some(diagnostics.sent_events),
                diagnostics.target.clone(),
            );
            result.diagnostics = Some(diagnostics);
            Ok(result)
        }
        Err(error) => {
            record_target(
                id,
                "delivery",
                Reason::Cancelled,
                started.elapsed().as_millis() as u64,
                Some(diagnostics.sent_events),
                diagnostics.target.clone(),
            );
            Err(error)
        }
    }
}

fn write_clipboard(
    text: &str,
    owner: windows_sys::Win32::Foundation::HWND,
    expected: Option<u32>,
    flag: &AtomicBool,
) -> Result<u32, Reason> {
    use windows_sys::Win32::{
        Foundation::{GlobalFree, HGLOBAL},
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        },
    };
    struct Memory(HGLOBAL);
    impl Drop for Memory {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    GlobalFree(self.0);
                }
            }
        }
    }
    struct Clipboard;
    impl Drop for Clipboard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }
    unsafe {
        let data: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let mut memory = Memory(GlobalAlloc(
            GMEM_MOVEABLE,
            data.len().checked_mul(2).ok_or(Reason::ClipboardFailed)?,
        ));
        if memory.0.is_null() {
            return Err(Reason::ClipboardFailed);
        }
        let pointer = GlobalLock(memory.0);
        if pointer.is_null() {
            return Err(Reason::ClipboardFailed);
        }
        std::ptr::copy_nonoverlapping(data.as_ptr(), pointer.cast::<u16>(), data.len());
        GlobalUnlock(memory.0);
        if owner.is_null() || OpenClipboard(owner) == 0 {
            return Err(Reason::ClipboardFailed);
        }
        let _clipboard = Clipboard;
        if expected.is_some_and(|old| GetClipboardSequenceNumber() != old) {
            return Err(Reason::ClipboardChanged);
        }
        if flag.load(Ordering::SeqCst) {
            return Err(Reason::Cancelled);
        }
        if EmptyClipboard() == 0 || SetClipboardData(13, memory.0).is_null() {
            return Err(Reason::ClipboardFailed);
        }
        memory.0 = std::ptr::null_mut(); // Windows owns the transferred memory.
        Ok(GetClipboardSequenceNumber())
    }
}

fn modifiers_pressed() -> bool {
    [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
        .iter()
        .any(|key| unsafe { GetAsyncKeyState(*key as i32) } < 0)
}
fn send_ctrl_v() -> u32 {
    fn key(vk: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0x57545950,
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
        sent
    }
}
