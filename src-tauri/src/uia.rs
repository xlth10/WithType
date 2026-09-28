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
            IUIAutomationTextPattern, IUIAutomationValuePattern, UIA_TextPatternId,
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
}
