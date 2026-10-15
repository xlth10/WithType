//! Windows UI Automation access. Create, use and drop on the same MTA worker.
use crate::delivery::policy::{self, Editability, Reason, TextWitness};
use std::time::{Duration, Instant};
use windows::{
    core::Interface,
    Win32::{
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_MULTITHREADED,
        },
        UI::Accessibility::{
            CUIAutomation8, IUIAutomation, IUIAutomation2, IUIAutomationElement,
            IUIAutomationLegacyIAccessiblePattern, IUIAutomationTextChildPattern,
            IUIAutomationTextEditPattern, IUIAutomationTextPattern, IUIAutomationTextPattern2,
            IUIAutomationTextRange, IUIAutomationValuePattern, TextPatternRangeEndpoint_End,
            TextPatternRangeEndpoint_Start, TextUnit_Character, TreeScope_Children,
            UIA_EditControlTypeId, UIA_IsReadOnlyAttributeId, UIA_LegacyIAccessiblePatternId,
            UIA_TextChildPatternId, UIA_TextEditPatternId, UIA_TextPattern2Id, UIA_TextPatternId,
            UIA_ValuePatternId,
        },
    },
};

struct ComApartment;

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub(crate) struct CaptureFailure {
    pub reason: Reason,
    pub hresult: Option<i32>,
}
impl From<Reason> for CaptureFailure {
    fn from(reason: Reason) -> Self {
        Self {
            reason,
            hresult: None,
        }
    }
}
fn provider_failure(error: windows::core::Error) -> CaptureFailure {
    CaptureFailure {
        reason: Reason::ProviderUnsupported,
        hresult: Some(error.code().0),
    }
}

pub struct FocusedField {
    automation: IUIAutomation,
    element: IUIAutomationElement,
    origin: IUIAutomationElement,
    native: isize,
    pid: u32,
    pub(crate) focus_source: &'static str,
    pub(crate) text_source: &'static str,
    // Fields drop in declaration order: COM interfaces must drop first.
    _apartment: ComApartment,
}
impl FocusedField {
    pub fn capture() -> Option<Self> {
        Self::capture_from(None, None, Instant::now() + Duration::from_millis(600)).ok()
    }

    pub(crate) fn capture_from(
        native: Option<isize>,
        pid: Option<u32>,
        deadline: Instant,
    ) -> Result<Self, CaptureFailure> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(provider_failure)?;
            let apartment = ComApartment;
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)
                    .map_err(provider_failure)?;
            let options: IUIAutomation2 = automation.cast().map_err(provider_failure)?;
            options
                .SetConnectionTimeout(120)
                .map_err(provider_failure)?;
            options
                .SetTransactionTimeout(120)
                .map_err(provider_failure)?;
            let (origin, focus_source) =
                focused_element(&automation, native).map_err(|error| CaptureFailure {
                    reason: Reason::NoFocus,
                    hresult: Some(error.code().0),
                })?;
            let origin_pid = origin.CurrentProcessId().map_err(provider_failure)? as u32;
            if origin_pid == std::process::id() {
                return Err(Reason::OwnProcess.into());
            }
            if pid.is_some_and(|expected| expected != origin_pid) {
                return Err(Reason::FocusChanged.into());
            }
            let native = origin
                .CurrentNativeWindowHandle()
                .ok()
                .filter(|h| !h.0.is_null())
                .map(|h| h.0 as isize)
                .or(native)
                .unwrap_or_default();
            guard_native(native)?;
            guard_element(&origin, origin_pid)?;
            if origin
                .CurrentHasKeyboardFocus()
                .ok()
                .is_some_and(|v| !v.as_bool())
            {
                return Err(Reason::FocusChanged.into());
            }
            if origin.CurrentIsEnabled().ok().is_some_and(|v| !v.as_bool()) {
                return Err(Reason::TargetDisabled.into());
            }
            let (element, text_source) = text_container(&automation, &origin, origin_pid, deadline);
            if Instant::now() >= deadline {
                return Err(Reason::CaptureTimeout.into());
            }
            Ok(Self {
                automation,
                element,
                origin,
                native,
                pid: origin_pid,
                focus_source,
                text_source,
                _apartment: apartment,
            })
        }
    }
    pub fn is_focused(&self) -> bool {
        unsafe {
            focused_element(&self.automation, Some(self.native))
                .ok()
                .and_then(|(current, _)| {
                    if !current
                        .CurrentHasKeyboardFocus()
                        .ok()
                        .is_some_and(|v| v.as_bool())
                    {
                        return None;
                    }
                    self.automation.CompareElements(&self.origin, &current).ok()
                })
                .is_some_and(|same| same.as_bool())
        }
    }

    // Rebind only a standard native Edit HWND. A recreated web element is not
    // enough evidence to select another field in the same browser window.
    pub(crate) fn rebind_native_edit(&mut self) -> bool {
        if native_read_only(self.native).is_none() {
            return false;
        }
        let Ok(next) = Self::capture_from(
            Some(self.native),
            Some(self.pid),
            Instant::now() + Duration::from_millis(400),
        ) else {
            return false;
        };
        if next.native != self.native || !next.is_focused() {
            return false;
        }
        *self = next;
        true
    }
    pub fn read(&self) -> Option<String> {
        self.guarded().ok()?;
        unsafe {
            if self.element.CurrentIsPassword().ok()?.as_bool() {
                return None;
            }
            let value = self
                .element
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .ok()
                .filter(|pattern| {
                    pattern
                        .CurrentIsReadOnly()
                        .ok()
                        .is_some_and(|v| !v.as_bool())
                })
                .and_then(|pattern| pattern.CurrentValue().ok());
            let text = if let Some(value) = value {
                value.to_string()
            } else {
                let pattern = text_pattern(&self.element)?;
                pattern
                    .DocumentRange()
                    .ok()?
                    .GetText(16385)
                    .ok()?
                    .to_string()
            };
            (text.chars().count() <= 16384).then_some(text)
        }
    }

    pub fn writable(&self) -> bool {
        self.guarded().is_ok()
            && self.enabled()
            && self.is_focused()
            && policy::may_paste(self.editability(), self.compatible_edit())
    }

    pub(crate) fn editability(&self) -> Editability {
        unsafe {
            let is_edit = self.element.CurrentControlType().ok() == Some(UIA_EditControlTypeId);
            let origin_is_edit =
                self.origin.CurrentControlType().ok() == Some(UIA_EditControlTypeId);
            let caret = self.active_caret();
            let active_caret = caret.is_some();
            let value = self
                .element
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .ok()
                .and_then(|p| p.CurrentIsReadOnly().ok())
                .map(|v| v.as_bool());
            let range = caret
                .or_else(|| {
                    if is_edit {
                        self.selection_range()
                    } else {
                        None
                    }
                })
                .and_then(|r| r.GetAttributeValue(UIA_IsReadOnlyAttributeId).ok())
                .and_then(|v| bool::try_from(&v).ok());
            let document = if range.is_none() && value.is_none() {
                text_pattern(&self.element)
                    .and_then(|p| p.DocumentRange().ok())
                    .and_then(|r| r.GetAttributeValue(UIA_IsReadOnlyAttributeId).ok())
                    .and_then(|v| bool::try_from(&v).ok())
            } else {
                None
            };
            let scoped = policy::text_read_only(range, value, document, is_edit, active_caret);
            let legacy = if !is_edit && active_caret && range == Some(false) {
                None
            } else {
                legacy_read_only(&self.element)
            };
            // Canonical text containers can be read-only documents. Preserve
            // explicit restrictions on the original focused Edit itself.
            let control_value = if origin_is_edit {
                self.origin
                    .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                    .ok()
                    .and_then(|p| p.CurrentIsReadOnly().ok())
                    .map(|v| v.as_bool())
            } else {
                None
            };
            let control_legacy = if origin_is_edit {
                legacy_read_only(&self.origin)
            } else {
                None
            };
            let text_edit = self
                .element
                .GetCurrentPatternAs::<IUIAutomationTextEditPattern>(UIA_TextEditPatternId)
                .is_ok();
            policy::editability(
                &[
                    scoped,
                    legacy,
                    control_value,
                    control_legacy,
                    native_read_only(self.native),
                ],
                text_edit,
            )
        }
    }

    pub(crate) fn compatible_edit(&self) -> bool {
        unsafe {
            self.origin.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && self
                    .origin
                    .CurrentHasKeyboardFocus()
                    .ok()
                    .is_some_and(|v| v.as_bool())
                && self.active_caret().is_some()
        }
    }

    pub(crate) fn enabled(&self) -> bool {
        unsafe {
            self.origin
                .CurrentIsEnabled()
                .ok()
                .is_some_and(|v| v.as_bool())
        }
    }

    pub(crate) fn guarded(&self) -> Result<(), Reason> {
        guard_native(self.native)?;
        unsafe {
            guard_element(&self.origin, self.pid)?;
            guard_element(&self.element, self.pid)
        }
    }

    fn active_caret(&self) -> Option<IUIAutomationTextRange> {
        unsafe {
            let pattern = self
                .element
                .GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id)
                .ok()?;
            let mut active = windows::core::BOOL::default();
            let range = pattern.GetCaretRange(&mut active).ok()?;
            active.as_bool().then_some(range)
        }
    }

    pub fn selection_range(&self) -> Option<IUIAutomationTextRange> {
        unsafe {
            if let Some(pattern) = text_pattern(&self.element) {
                if let Ok(ranges) = pattern.GetSelection() {
                    if ranges.Length().ok()? == 1 {
                        return ranges.GetElement(0).ok()?.Clone().ok();
                    }
                    if ranges.Length().ok()? > 1 {
                        return None;
                    }
                }
            }
            self.active_caret().and_then(|r| r.Clone().ok())
        }
    }

    pub(crate) fn witness(&self, radius: usize) -> Option<TextWitness> {
        self.guarded().ok()?;
        unsafe {
            let selection = self.selection_range()?;
            // Never use a truncated selection as evidence that its contents
            // stayed unchanged while recording.
            let selected = selection.GetText(16385).ok()?.to_string();
            if selected.encode_utf16().count() > 16384 {
                return None;
            }
            let radius = radius.min(16384) as i32;
            let before = selection.Clone().ok()?;
            before
                .MoveEndpointByRange(
                    TextPatternRangeEndpoint_End,
                    &selection,
                    TextPatternRangeEndpoint_Start,
                )
                .ok()?;
            before
                .MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -radius)
                .ok()?;
            let after = selection.Clone().ok()?;
            after
                .MoveEndpointByRange(
                    TextPatternRangeEndpoint_Start,
                    &selection,
                    TextPatternRangeEndpoint_End,
                )
                .ok()?;
            after
                .MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Character, radius)
                .ok()?;
            let before = before.GetText(16385).ok()?.to_string();
            let after = after.GetText(16385).ok()?.to_string();
            if before.encode_utf16().count() > 16384 || after.encode_utf16().count() > 16384 {
                return None;
            }
            Some(TextWitness {
                before,
                selected,
                after,
            })
        }
    }

    pub fn selection_matches(&self, initial: &IUIAutomationTextRange) -> bool {
        unsafe {
            self.selection_range().is_some_and(|now| {
                now.CompareEndpoints(
                    TextPatternRangeEndpoint_Start,
                    initial,
                    TextPatternRangeEndpoint_Start,
                )
                .ok()
                    == Some(0)
                    && now
                        .CompareEndpoints(
                            TextPatternRangeEndpoint_End,
                            initial,
                            TextPatternRangeEndpoint_End,
                        )
                        .ok()
                        == Some(0)
            })
        }
    }

    pub fn caret(&self) -> Option<crate::card_position::Rect> {
        unsafe {
            let range = self.active_caret()?;
            if let Some(rect) = range_rect(&range) {
                return Some(rect);
            }
            // Degenerate text ranges can have no rectangles. Expand a clone,
            // preserving the real selection, and use the appropriate edge.
            let expanded = range.Clone().ok()?;
            expanded.ExpandToEnclosingUnit(TextUnit_Character).ok()?;
            let mut rect = range_rect(&expanded)?;
            if range
                .CompareEndpoints(
                    TextPatternRangeEndpoint_Start,
                    &expanded,
                    TextPatternRangeEndpoint_End,
                )
                .ok()
                == Some(0)
            {
                rect.x += rect.width;
            }
            rect.width = 1;
            Some(rect)
        }
    }
}

unsafe fn focused_element(
    automation: &IUIAutomation,
    native: Option<isize>,
) -> windows::core::Result<(IUIAutomationElement, &'static str)> {
    match automation.GetFocusedElement() {
        Ok(element) => Ok((element, "focused_element")),
        Err(error) => {
            let Some(hwnd) = native.filter(|h| *h != 0) else {
                return Err(error);
            };
            automation
                .ElementFromHandle(windows::Win32::Foundation::HWND(
                    hwnd as *mut std::ffi::c_void,
                ))
                .map(|element| (element, "native_handle"))
        }
    }
}

unsafe fn guard_element(element: &IUIAutomationElement, pid: u32) -> Result<(), Reason> {
    if element.CurrentProcessId().ok().map(|id| id as u32) != Some(pid) {
        return Err(Reason::FocusChanged);
    }
    // An unavailable password property is not permission to inspect the field.
    match element.CurrentIsPassword().ok().map(|v| v.as_bool()) {
        Some(false) => Ok(()),
        _ => Err(Reason::Password),
    }
}

unsafe fn text_pattern(element: &IUIAutomationElement) -> Option<IUIAutomationTextPattern> {
    element
        .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
        .ok()
        .or_else(|| {
            element
                .GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id)
                .ok()
                .and_then(|p| p.cast().ok())
        })
        .or_else(|| {
            element
                .GetCurrentPatternAs::<IUIAutomationTextEditPattern>(UIA_TextEditPatternId)
                .ok()
                .and_then(|p| p.cast().ok())
        })
}

unsafe fn legacy_read_only(element: &IUIAutomationElement) -> Option<bool> {
    let pattern = element
        .GetCurrentPatternAs::<IUIAutomationLegacyIAccessiblePattern>(
            UIA_LegacyIAccessiblePatternId,
        )
        .ok()?;
    let state = pattern.CurrentState().ok()?;
    if state & 0x41 != 0 {
        Some(true)
    } else if pattern.CurrentRole().ok()? == 42 {
        Some(false)
    } else {
        None
    }
}

unsafe fn text_container(
    automation: &IUIAutomation,
    origin: &IUIAutomationElement,
    pid: u32,
    deadline: Instant,
) -> (IUIAutomationElement, &'static str) {
    let usable = |candidate: &IUIAutomationElement| {
        Instant::now() < deadline
            && guard_element(candidate, pid).is_ok()
            && (text_pattern(candidate).is_some()
                || candidate
                    .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                    .is_ok())
    };
    if usable(origin) {
        return (origin.clone(), "focused");
    }
    if let Ok(child) =
        origin.GetCurrentPatternAs::<IUIAutomationTextChildPattern>(UIA_TextChildPatternId)
    {
        if let Ok(container) = child.TextContainer() {
            if usable(&container) {
                return (container, "text_child");
            }
        }
    }
    if Instant::now() < deadline {
        if let Ok(walker) = automation.RawViewWalker() {
            if let Ok(parent) = walker.GetParentElement(origin) {
                if usable(&parent) {
                    return (parent, "parent");
                }
            }
        }
    }
    if Instant::now() < deadline {
        if let Ok(condition) = automation.CreateTrueCondition() {
            if let Ok(children) = origin.FindAll(TreeScope_Children, &condition) {
                for index in 0..children.Length().unwrap_or_default().min(8) {
                    if Instant::now() >= deadline {
                        break;
                    }
                    if let Ok(child) = children.GetElement(index) {
                        if child
                            .CurrentHasKeyboardFocus()
                            .ok()
                            .is_some_and(|v| v.as_bool())
                            && usable(&child)
                        {
                            return (child, "focused_child");
                        }
                    }
                }
            }
        }
    }
    (origin.clone(), "unsupported")
}

fn native_read_only(native: isize) -> Option<bool> {
    native_edit_style(native).map(|style| style & 0x0800 != 0) // ES_READONLY
}

fn guard_native(native: isize) -> Result<(), Reason> {
    if native_edit_style(native).is_some_and(|style| style & 0x0020 != 0) {
        // ES_PASSWORD
        Err(Reason::Password)
    } else {
        Ok(())
    }
}

fn native_edit_style(native: isize) -> Option<isize> {
    use windows_sys::Win32::Foundation::{GetLastError, SetLastError};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetWindowLongPtrW, IsWindow, GWL_STYLE,
    };
    unsafe {
        let hwnd = native as windows_sys::Win32::Foundation::HWND;
        if native == 0 || IsWindow(hwnd) == 0 {
            return None;
        }
        let mut buffer = [0u16; 256];
        let len = GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        let class = String::from_utf16_lossy(&buffer[..len.max(0) as usize]).to_ascii_lowercase();
        if class != "edit"
            && !class.starts_with("richedit")
            && !class.starts_with("windowsforms10.edit.")
        {
            return None;
        }
        SetLastError(0);
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        if style == 0 && GetLastError() != 0 {
            return None;
        }
        Some(style)
    }
}

unsafe fn range_rect(range: &IUIAutomationTextRange) -> Option<crate::card_position::Rect> {
    use windows::Win32::System::Ole::{
        SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetLBound, SafeArrayGetUBound,
        SafeArrayGetVartype, SafeArrayUnaccessData,
    };
    use windows::Win32::System::Variant::VT_R8;
    struct Array(*mut windows::Win32::System::Com::SAFEARRAY);
    impl Drop for Array {
        fn drop(&mut self) {
            unsafe {
                let _ = SafeArrayDestroy(self.0);
            }
        }
    }
    let array = Array(range.GetBoundingRectangles().ok()?);
    if array.0.is_null() || SafeArrayGetVartype(array.0).ok()? != VT_R8 {
        return None;
    }
    let low = SafeArrayGetLBound(array.0, 1).ok()?;
    let high = SafeArrayGetUBound(array.0, 1).ok()?;
    let count = (high - low + 1).max(0) as usize;
    if count < 4 || count > 4096 {
        return None;
    }
    let mut data = std::ptr::null_mut();
    SafeArrayAccessData(array.0, &mut data).ok()?;
    let result = if data.is_null() {
        None
    } else {
        std::slice::from_raw_parts(data.cast::<f64>(), count)
            .chunks_exact(4)
            .find(|r| r.iter().all(|v| v.is_finite()) && r[2] >= 0.0 && r[3] > 0.0)
            .map(|r| crate::card_position::Rect {
                x: r[0].round() as i32,
                y: r[1].round() as i32,
                width: r[2].round() as i32,
                height: r[3].round() as i32,
            })
    };
    let _ = SafeArrayUnaccessData(array.0);
    result
}
