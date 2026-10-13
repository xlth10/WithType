//! Windows UI Automation access. Create, use and drop on the same MTA worker.
use windows::{
    core::Interface,
    Win32::{
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_MULTITHREADED,
        },
        UI::Accessibility::{
            CUIAutomation8, IUIAutomation, IUIAutomation2, IUIAutomationElement,
            IUIAutomationTextPattern, IUIAutomationTextPattern2, IUIAutomationTextRange,
            IUIAutomationValuePattern, TextPatternRangeEndpoint_End,
            TextPatternRangeEndpoint_Start, TextUnit_Character, UIA_IsReadOnlyAttributeId,
            UIA_TextPattern2Id, UIA_TextPatternId, UIA_ValuePatternId,
        },
    },
};

struct ComApartment;
impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub struct FocusedField {
    automation: IUIAutomation,
    element: IUIAutomationElement,
    // Fields drop in declaration order: COM interfaces must drop first.
    _apartment: ComApartment,
}
impl FocusedField {
    pub fn capture() -> Option<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok()?;
            let apartment = ComApartment;
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER).ok()?;
            let options: IUIAutomation2 = automation.cast().ok()?;
            options.SetConnectionTimeout(300).ok()?;
            options.SetTransactionTimeout(300).ok()?;
            let element = automation.GetFocusedElement().ok()?;
            if element.CurrentIsPassword().ok()?.as_bool()
                || element.CurrentProcessId().ok()? as u32 == std::process::id()
            {
                return None;
            }
            Some(Self {
                automation,
                element,
                _apartment: apartment,
            })
        }
    }
    pub fn is_focused(&self) -> bool {
        unsafe {
            self.automation
                .GetFocusedElement()
                .ok()
                .and_then(|current| {
                    self.automation
                        .CompareElements(&self.element, &current)
                        .ok()
                })
                .is_some_and(|same| same.as_bool())
        }
    }
    pub fn read(&self) -> Option<String> {
        unsafe {
            if self.element.CurrentIsPassword().ok()?.as_bool() {
                return None;
            }
            let text = if let Ok(pattern) = self
                .element
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            {
                if pattern.CurrentIsReadOnly().ok()?.as_bool() {
                    return None;
                }
                pattern.CurrentValue().ok()?.to_string()
            } else {
                let pattern = self
                    .element
                    .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                    .ok()?;
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
        unsafe {
            if !self
                .element
                .CurrentIsEnabled()
                .ok()
                .is_some_and(|v| v.as_bool())
                || !self
                    .element
                    .CurrentHasKeyboardFocus()
                    .ok()
                    .is_some_and(|v| v.as_bool())
            {
                return false;
            }
            if let Ok(p) = self
                .element
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            {
                return p.CurrentIsReadOnly().ok().is_some_and(|v| !v.as_bool());
            }
            self.element
                .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                .ok()
                .and_then(|p| p.DocumentRange().ok())
                .and_then(|r| r.GetAttributeValue(UIA_IsReadOnlyAttributeId).ok())
                .and_then(|v| bool::try_from(&v).ok())
                .is_some_and(|read_only| !read_only)
        }
    }

    pub fn selection_range(&self) -> Option<IUIAutomationTextRange> {
        unsafe {
            let pattern = self
                .element
                .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                .ok()?;
            let ranges = pattern.GetSelection().ok()?;
            if ranges.Length().ok()? != 1 {
                return None;
            }
            ranges.GetElement(0).ok()?.Clone().ok()
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
            let pattern = self
                .element
                .GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id)
                .ok()?;
            let mut active = windows::core::BOOL::default();
            let range = pattern.GetCaretRange(&mut active).ok()?;
            if !active.as_bool() {
                return None;
            }
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
