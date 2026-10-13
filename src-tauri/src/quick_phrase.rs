// Local reusable text and the shared clipboard lease. No model or history access.
use std::sync::atomic::{AtomicBool, Ordering};

pub const MAX_NAME_CHARS: usize = 40;
pub const MAX_TEXT_CHARS: usize = 2000;

#[derive(Clone, Default)]
pub struct QuickPhrase {
    pub name: String,
    pub text: String,
}

impl QuickPhrase {
    pub fn new(name: &str, text: &str) -> Result<Self, String> {
        if name.chars().count() > MAX_NAME_CHARS || text.chars().count() > MAX_TEXT_CHARS {
            return Err("短语名称最多 40 字，内容最多 2000 字".into());
        }
        if name.contains('\0') || text.contains('\0') {
            return Err("短语不能包含空字符".into());
        }
        Ok(Self {
            name: name.trim().to_string(),
            text: text.to_string(),
        })
    }

    pub fn ready(&self) -> Result<(), String> {
        if self.text.trim().is_empty() {
            Err("请先在快捷键页填写短语内容".into())
        } else {
            Ok(())
        }
    }
}

// Held through clipboard restoration, so a second paste cannot overwrite the
// first paste's backup (particularly when both insert the same phone number).
pub struct InputPermit<'a>(&'a AtomicBool);
impl<'a> InputPermit<'a> {
    pub fn acquire(busy: &'a AtomicBool) -> Option<Self> {
        busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| Self(busy))
    }
}
impl Drop for InputPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_leading_zeroes_spaces_and_line_breaks() {
        let phrase = QuickPhrase::new("  手机号  ", " 0012345\r\n第二行 ").unwrap();
        assert_eq!(phrase.name, "手机号");
        assert_eq!(phrase.text, " 0012345\r\n第二行 ");
        assert!(phrase.ready().is_ok());
    }
    #[test]
    fn empty_is_storable_but_cannot_be_inserted() {
        assert!(QuickPhrase::new("", " \n ").unwrap().ready().is_err());
    }
    #[test]
    fn rejects_invalid_or_oversized_text_without_silent_truncation() {
        assert!(QuickPhrase::new("", "abc\0def").is_err());
        assert!(QuickPhrase::new("", &"字".repeat(2001)).is_err());
        assert!(QuickPhrase::new(&"字".repeat(41), "x").is_err());
        assert!(QuickPhrase::new("", &"墨".repeat(2000)).is_ok());
    }
    #[test]
    fn overlapping_inputs_are_rejected_until_the_clipboard_lease_ends() {
        let busy = AtomicBool::new(false);
        let first = InputPermit::acquire(&busy).unwrap();
        assert!(InputPermit::acquire(&busy).is_none());
        drop(first);
        assert!(InputPermit::acquire(&busy).is_some());
    }
    #[test]
    fn early_return_releases_the_clipboard_lease() {
        fn fail(busy: &AtomicBool) -> Result<(), ()> {
            let _permit = InputPermit::acquire(busy).unwrap();
            Err(())
        }
        let busy = AtomicBool::new(false);
        assert!(fail(&busy).is_err());
        assert!(InputPermit::acquire(&busy).is_some());
    }
}
