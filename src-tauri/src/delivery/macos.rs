//! macOS AX focus ownership and one Cmd+V. Unsupported targets retain the result.
use super::*;
use objc2::{class, msg_send, runtime::AnyObject};
use std::{
    ffi::c_void,
    ptr, thread,
    time::{Duration, Instant},
};

type CF = *const c_void;
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct Range {
    location: isize,
    length: isize,
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: CF);
    fn CFEqual(a: CF, b: CF) -> u8;
    fn CFGetTypeID(value: CF) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFStringCreateWithBytes(
        allocator: CF,
        bytes: *const u8,
        length: isize,
        encoding: u32,
        external: u8,
    ) -> CF;
    fn CFStringGetLength(value: CF) -> isize;
    fn CFStringGetCString(value: CF, bytes: *mut u8, capacity: isize, encoding: u32) -> u8;
    fn CFBooleanGetValue(value: CF) -> u8;
}
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXUIElementCreateSystemWide() -> CF;
    fn AXUIElementCopyAttributeValue(element: CF, name: CF, value: *mut CF) -> i32;
    fn AXUIElementIsAttributeSettable(element: CF, name: CF, settable: *mut u8) -> i32;
    fn AXUIElementSetMessagingTimeout(element: CF, timeout: f32) -> i32;
    fn AXUIElementGetPid(element: CF, pid: *mut i32) -> i32;
    fn AXValueGetValue(value: CF, kind: u32, out: *mut c_void) -> u8;
    fn CGEventSourceFlagsState(state: i32) -> u64;
    fn CGEventCreateKeyboardEvent(source: CF, key: u16, down: bool) -> CF;
    fn CGEventSetFlags(event: CF, flags: u64);
    fn CGEventPost(tap: u32, event: CF);
}
#[link(name = "AppKit", kind = "framework")]
extern "C" {}

// CF/AX references are retained and used only under the serialized delivery mutex.
struct Object(CF);
unsafe impl Send for Object {}
impl Drop for Object {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                CFRelease(self.0);
            }
        }
    }
}
impl Object {
    fn own(raw: CF) -> Option<Self> {
        (!raw.is_null()).then(|| Self(raw))
    }
    fn string(text: &str) -> Self {
        Self(unsafe {
            CFStringCreateWithBytes(
                ptr::null(),
                text.as_ptr(),
                text.len() as isize,
                0x08000100,
                0,
            )
        })
    }
    fn attr(&self, name: &str) -> Option<Self> {
        let name = Self::string(name);
        let mut value = ptr::null();
        (unsafe { AXUIElementCopyAttributeValue(self.0, name.0, &mut value) } == 0)
            .then(|| Self::own(value))
            .flatten()
    }
    fn text(&self) -> Option<String> {
        unsafe {
            if CFGetTypeID(self.0) != CFStringGetTypeID() {
                return None;
            }
            let length = CFStringGetLength(self.0);
            if length > 200_000 {
                return None;
            }
            let mut buffer = vec![0; length as usize * 4 + 1];
            if CFStringGetCString(
                self.0,
                buffer.as_mut_ptr(),
                buffer.len() as isize,
                0x08000100,
            ) == 0
            {
                return None;
            }
            let end = buffer.iter().position(|b| *b == 0).unwrap_or(buffer.len());
            String::from_utf8(buffer[..end].to_vec()).ok()
        }
    }
}

fn clipboard_sequence() -> isize {
    unsafe {
        let board: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
        msg_send![board, changeCount]
    }
}
fn focused() -> Option<Object> {
    let system = Object::own(unsafe { AXUIElementCreateSystemWide() })?;
    unsafe {
        AXUIElementSetMessagingTimeout(system.0, 0.15);
    }
    let field = system.attr("AXFocusedUIElement")?;
    unsafe {
        AXUIElementSetMessagingTimeout(field.0, 0.15);
    }
    Some(field)
}

pub(crate) fn learning_permission_granted() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}

/// Retains exactly the verified target. It is moved to one observation worker,
/// never shared with delivery and never used to modify the external field.
pub(crate) struct FocusedCorrectionField {
    element: Object,
}
impl FocusedCorrectionField {
    pub(crate) fn is_focused(&self) -> bool {
        if !learning_permission_granted() {
            return false;
        }
        let Some(now) = focused() else {
            return false;
        };
        (unsafe { CFEqual(self.element.0, now.0) != 0 }) && field_reason(&now) == Reason::Ready
    }
    pub(crate) fn read(&self) -> Option<String> {
        if !learning_permission_granted() {
            return None;
        }
        self.element.attr("AXValue")?.text()
    }
}

fn selection(field: &Object) -> Option<Range> {
    let value = field.attr("AXSelectedTextRange")?;
    let mut range = Range {
        location: 0,
        length: 0,
    };
    (unsafe { AXValueGetValue(value.0, 4, (&mut range as *mut Range).cast()) } != 0)
        .then_some(range)
}
fn field_reason(field: &Object) -> Reason {
    let role = field
        .attr("AXRole")
        .and_then(|v| v.text())
        .unwrap_or_default();
    let subtype = field
        .attr("AXSubrole")
        .and_then(|v| v.text())
        .unwrap_or_default();
    if role == "AXSecureTextField" || subtype == "AXSecureTextField" {
        return Reason::Password;
    }
    if let Some(enabled) = field.attr("AXEnabled") {
        if unsafe { CFBooleanGetValue(enabled.0) } == 0 {
            return Reason::TargetDisabled;
        }
    }
    let name = Object::string("AXValue");
    let mut writable = 0;
    let settable = unsafe { AXUIElementIsAttributeSettable(field.0, name.0, &mut writable) } == 0
        && writable != 0;
    if settable && matches!(role.as_str(), "AXTextField" | "AXTextArea" | "AXComboBox") {
        Reason::Ready
    } else {
        Reason::ProviderUnsupported
    }
}

struct Target {
    field: Option<Object>,
    before: Option<String>,
    selection: Option<Range>,
    sequence: isize,
    capture: CaptureInfo,
}
fn targets() -> &'static Mutex<HashMap<String, Target>> {
    static VALUES: OnceLock<Mutex<HashMap<String, Target>>> = OnceLock::new();
    VALUES.get_or_init(Default::default)
}
static SERIAL: Mutex<()> = Mutex::new(());
fn snapshot() -> Target {
    let started = Instant::now();
    let sequence = clipboard_sequence();
    let field = if unsafe { AXIsProcessTrusted() } != 0 {
        focused()
    } else {
        None
    };
    let mut reason = if field.is_some() {
        Reason::Ready
    } else {
        Reason::NoFocus
    };
    let mut identity = None;
    if let Some(field) = &field {
        let mut pid = 0;
        unsafe {
            AXUIElementGetPid(field.0, &mut pid);
        }
        reason = if pid as u32 == std::process::id() {
            Reason::OwnProcess
        } else {
            field_reason(field)
        };
        identity = Some(TargetIdentity {
            window: pid as isize,
            child: 0,
            process_id: pid as u32,
            focus_source: Some("macos_accessibility"),
            text_source: Some("ax_value"),
            hresult: None,
        });
    }
    let before = if reason == Reason::Ready {
        field
            .as_ref()
            .and_then(|f| f.attr("AXValue"))
            .and_then(|v| v.text())
    } else {
        None
    };
    let range = field.as_ref().and_then(selection);
    let mut capture = CaptureInfo::new(reason, started.elapsed().as_millis() as u64);
    capture.target = identity;
    if unsafe { AXIsProcessTrusted() } == 0 {
        capture.message =
            "请在系统设置 → 隐私与安全性 → 辅助功能中允许 WithType；当前结果可手动复制".into();
    }
    Target {
        field,
        before,
        selection: range,
        sequence,
        capture,
    }
}
pub(super) fn prime(id: String, flag: Arc<AtomicBool>) {
    if flag.load(Ordering::SeqCst) {
        return;
    }
    let Ok(_serial) = SERIAL.lock() else {
        return;
    };
    let target = snapshot();
    if let Ok(mut values) = targets().lock() {
        if values.len() >= 256 {
            values.clear();
        }
        values.insert(id, target);
    }
}
pub(super) fn capture(
    id: String,
    flag: Arc<AtomicBool>,
    input_token: Option<String>,
) -> Result<CaptureInfo, String> {
    let _serial = SERIAL.lock().map_err(|e| e.to_string())?;
    if flag.load(Ordering::SeqCst) {
        return Err("输入已取消".into());
    }
    let mut values = targets().lock().map_err(|e| e.to_string())?;
    let target = input_token
        .and_then(|key| values.remove(&key))
        .or_else(|| values.remove(&id))
        .unwrap_or_else(snapshot);
    let info = target.capture.clone();
    if values.len() >= 256 {
        values.clear();
    }
    values.insert(id, target);
    Ok(info)
}
fn unchanged(target: &Target) -> Result<(), Reason> {
    let now = focused().ok_or(Reason::NoFocus)?;
    let before = target.field.as_ref().ok_or(Reason::CaptureMissing)?;
    if unsafe { CFEqual(before.0, now.0) } == 0 {
        return Err(Reason::FocusChanged);
    }
    if field_reason(&now) != Reason::Ready {
        return Err(Reason::ReadOnly);
    }
    if target.selection != selection(&now) {
        return Err(Reason::SelectionChanged);
    }
    if let Some(before) = &target.before {
        if now.attr("AXValue").and_then(|v| v.text()).as_ref() != Some(before) {
            return Err(Reason::ContentChanged);
        }
    }
    Ok(())
}
fn expected_value(before: &str, range: Range, text: &str) -> Option<String> {
    let utf16: Vec<_> = before.encode_utf16().collect();
    let start = usize::try_from(range.location).ok()?;
    let end = start.checked_add(usize::try_from(range.length).ok()?)?;
    if end > utf16.len() {
        return None;
    }
    let mut result = utf16[..start].to_vec();
    result.extend(text.encode_utf16());
    result.extend_from_slice(&utf16[end..]);
    String::from_utf16(&result).ok()
}
pub(super) fn deliver(
    text: String,
    id: String,
    auto: bool,
    flag: Arc<AtomicBool>,
    app: tauri::AppHandle,
    learn: bool,
) -> Result<Delivery, String> {
    crate::correction_monitor::stop_learning_monitor();
    let _serial = SERIAL.lock().map_err(|e| e.to_string())?;
    let target = targets().lock().map_err(|e| e.to_string())?.remove(&id);
    if flag.load(Ordering::SeqCst) {
        return Err("输入已取消".into());
    }
    if let Some(target) = &target {
        if clipboard_sequence() != target.sequence {
            let mut result = Delivery::retained(Reason::ClipboardChanged.message());
            result.reason = Reason::ClipboardChanged;
            return Ok(result);
        }
    }
    let mut result = match arboard::Clipboard::new().and_then(|mut c| c.set_text(&text)) {
        Ok(_) => Delivery::copied("已复制，可以粘贴"),
        Err(e) => return Ok(Delivery::retained(format!("复制失败，结果已保留：{e}"))),
    };
    if !auto {
        return Ok(result);
    }
    let Some(target) = target else {
        result.reason = Reason::CaptureMissing;
        result.message = result.reason.message().into();
        return Ok(result);
    };
    if target.capture.reason != Reason::Ready {
        result.reason = target.capture.reason;
        result.message = format!("{}；结果已复制", target.capture.message);
        return Ok(result);
    }
    let sequence = clipboard_sequence();
    let wait = Instant::now();
    const MODIFIERS: u64 = (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20);
    while unsafe { CGEventSourceFlagsState(0) } & MODIFIERS != 0
        && wait.elapsed() < Duration::from_millis(1500)
    {
        if flag.load(Ordering::SeqCst) {
            return Err("输入已取消".into());
        }
        thread::sleep(Duration::from_millis(15));
    }
    let reason = if unsafe { CGEventSourceFlagsState(0) } & MODIFIERS != 0 {
        Some(Reason::ModifiersHeld)
    } else if clipboard_sequence() != sequence {
        Some(Reason::ClipboardChanged)
    } else {
        unchanged(&target).err()
    };
    if let Some(reason) = reason {
        result.reason = reason;
        result.message = format!("{}；结果已保留", reason.message());
        return Ok(result);
    }
    let events: Option<Vec<Object>> = [
        (55, true, 1 << 20),
        (9, true, 1 << 20),
        (9, false, 1 << 20),
        (55, false, 0),
    ]
    .into_iter()
    .map(|(key, down, flags)| {
        let event = Object::own(unsafe { CGEventCreateKeyboardEvent(ptr::null(), key, down) })?;
        unsafe {
            CGEventSetFlags(event.0, flags);
        }
        Some(event)
    })
    .collect();
    let Some(events) = events else {
        result.reason = Reason::SendFailed;
        result.message = result.reason.message().into();
        return Ok(result);
    };
    if flag.load(Ordering::SeqCst) {
        return Err("输入已取消".into());
    }
    if clipboard_sequence() != sequence || unchanged(&target).is_err() {
        result.reason = Reason::FocusChanged;
        result.message = result.reason.message().into();
        return Ok(result);
    }
    for event in &events {
        unsafe {
            CGEventPost(0, event.0);
        }
    }
    result.reason = Reason::SentUnverified;
    let expected = target
        .before
        .as_ref()
        .zip(target.selection)
        .and_then(|(before, range)| expected_value(before, range, &text));
    if let Some(expected) = expected {
        let started = Instant::now();
        while started.elapsed() < Duration::from_millis(700) {
            thread::sleep(Duration::from_millis(35));
            let Some(field) = focused() else {
                break;
            };
            if unsafe { CFEqual(target.field.as_ref().unwrap().0, field.0) } == 0 {
                break;
            }
            if field.attr("AXValue").and_then(|v| v.text()).as_ref() == Some(&expected) {
                result.pasted = true;
                result.status = "inserted".into();
                result.reason = Reason::Inserted;
                break;
            }
        }
    }
    // Only a witnessed paste at the captured UTF-16 selection can begin
    // learning. Failed/unverified sends and copy-only actions never observe.
    if result.pasted && learn && crate::correction_monitor::is_enabled() {
        let anchors = target
            .before
            .as_ref()
            .zip(target.selection)
            .and_then(|(before, range)| {
                crate::correction_monitor::Anchors::from_utf16_range(
                    before,
                    usize::try_from(range.location).ok()?,
                    usize::try_from(range.length).ok()?,
                )
            });
        if let (Some(field), Some(anchors)) = (target.field, anchors) {
            crate::correction_monitor::start_confirmed(
                app,
                text,
                id,
                FocusedCorrectionField { element: field },
                anchors,
                flag,
            );
        }
    }
    result.message = result.reason.message().into();
    result.diagnostics = Some(DeliveryDiagnostics {
        sent_events: 4,
        target: target.capture.target,
        ..Default::default()
    });
    Ok(result)
}
pub(super) fn caret() -> Option<crate::card_position::Rect> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn insertion_uses_accessibility_utf16_ranges() {
        assert_eq!(
            expected_value(
                "前🙂旧后",
                Range {
                    location: 3,
                    length: 1
                },
                "新文字"
            ),
            Some("前🙂新文字后".into())
        );
        assert_eq!(
            expected_value(
                "abc",
                Range {
                    location: 9,
                    length: 0
                },
                "x"
            ),
            None
        );
        assert_eq!(
            expected_value(
                "🙂",
                Range {
                    location: 1,
                    length: 0
                },
                "x"
            ),
            None
        );
    }
}
