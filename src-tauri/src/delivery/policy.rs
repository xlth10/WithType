//! Decisions shared by the Windows worker and its platform-independent tests.
use serde::Serialize;
use std::borrow::Cow;

pub(crate) fn comparable_lines(text: &str) -> Cow<'_, str> {
    if text.contains('\r') {
        Cow::Owned(text.replace("\r\n", "\n").replace('\r', "\n"))
    } else {
        Cow::Borrowed(text)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Editability {
    Writable,
    ReadOnly,
    Unknown,
}

pub(crate) fn editability(read_only: &[Option<bool>], text_edit: bool) -> Editability {
    if read_only.contains(&Some(true)) {
        Editability::ReadOnly
    } else if read_only.contains(&Some(false)) || text_edit {
        Editability::Writable
    } else {
        Editability::Unknown
    }
}

pub(crate) fn text_read_only(
    range: Option<bool>,
    value: Option<bool>,
    document: Option<bool>,
    is_edit: bool,
    active_caret: bool,
) -> Option<bool> {
    // A focused Edit's explicit read-only flag remains a hard refusal. On a
    // document container, an active range can be editable inside read-only
    // document metadata. A retained, inactive selection cannot authorize it.
    if is_edit && value == Some(true) {
        return Some(true);
    }
    range
        .filter(|_| is_edit || active_caret)
        .or(value)
        .or(document)
}

pub(crate) fn may_paste(value: Editability, compatible_edit: bool) -> bool {
    value == Editability::Writable || (value == Editability::Unknown && compatible_edit)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    Ready,
    Compatibility,
    CopyRequested,
    NoFocus,
    OwnProcess,
    Password,
    ProviderUnsupported,
    TargetDisabled,
    ReadOnly,
    CaptureBusy,
    CaptureTimeout,
    CaptureMissing,
    FocusChanged,
    SelectionChanged,
    ContentChanged,
    ModifiersHeld,
    ClipboardChanged,
    ClipboardFailed,
    Cancelled,
    SendFailed,
    SentUnverified,
    Inserted,
    DeliveryTimeout,
    PlatformUnsupported,
}
impl Reason {
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Ready | Self::Compatibility => "已找到输入位置",
            Self::CopyRequested => "已复制，可以粘贴",
            Self::NoFocus => "没有找到正在输入的位置",
            Self::OwnProcess => "请先切换到目标应用的输入框",
            Self::Password => "此输入框不允许语音自动输入",
            Self::ProviderUnsupported => "此输入框尚不能确认可写",
            Self::TargetDisabled => "此输入框当前不可用",
            Self::ReadOnly => "此位置是只读内容",
            Self::CaptureBusy => "输入位置检查繁忙",
            Self::CaptureTimeout => "输入位置检查超时",
            Self::CaptureMissing => "原输入位置检查已失效，请在目标输入框重新开始",
            Self::FocusChanged => "输入位置已变化",
            Self::SelectionChanged => "光标或选区已变化",
            Self::ContentChanged => "光标附近的内容已变化",
            Self::ModifiersHeld => "快捷键尚未松开",
            Self::ClipboardChanged => "剪贴板已被更新，保留了新复制的内容",
            Self::ClipboardFailed => "无法写入剪贴板",
            Self::Cancelled => "输入已取消",
            Self::SendFailed => "自动输入未完成",
            Self::SentUnverified => "已发送粘贴，尚未确认输入",
            Self::Inserted => "已输入",
            Self::DeliveryTimeout => "输入尚未确认，结果已保留，请手动复制",
            Self::PlatformUnsupported => "当前平台未启用自动输入",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TextWitness {
    pub before: String,
    pub selected: String,
    pub after: String,
}
impl TextWitness {
    pub(crate) fn confirms(&self, now: &Self, text: &str) -> bool {
        !text.is_empty()
            && self != now
            && now.selected.is_empty()
            && comparable_lines(&now.before).ends_with(&format!(
                "{}{}",
                comparable_lines(&self.before),
                comparable_lines(text)
            ))
            && comparable_lines(&now.after).starts_with(comparable_lines(&self.after).as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_read_only_is_unknown_and_explicit_read_only_always_wins() {
        assert_eq!(editability(&[None], false), Editability::Unknown);
        assert!(!may_paste(Editability::Unknown, false));
        assert!(may_paste(Editability::Unknown, true));
        let value = editability(&[None, Some(true)], true);
        assert_eq!(value, Editability::ReadOnly);
        assert!(!may_paste(value, true));
        assert_eq!(editability(&[Some(false)], false), Editability::Writable);
        assert_eq!(editability(&[None], true), Editability::Writable);
    }

    #[test]
    fn active_editable_caret_in_a_read_only_document_accepts_input() {
        let scoped = text_read_only(Some(false), Some(true), Some(true), false, true);
        assert_eq!(editability(&[scoped], false), Editability::Writable);
    }

    #[test]
    fn edit_control_with_unsupported_patterns_needs_compatibility_evidence() {
        let scoped = text_read_only(None, None, None, true, false);
        assert_eq!(editability(&[scoped], false), Editability::Unknown);
        assert!(!may_paste(editability(&[scoped], false), false));
    }

    #[test]
    fn scoped_caret_cannot_override_an_explicitly_read_only_edit_control() {
        let scoped = text_read_only(Some(false), Some(true), None, true, true);
        assert_eq!(editability(&[scoped], true), Editability::ReadOnly);
        assert_eq!(
            editability(&[Some(false), Some(true)], true),
            Editability::ReadOnly
        );
        let scoped = text_read_only(Some(true), Some(false), Some(false), true, false);
        assert_eq!(editability(&[scoped], false), Editability::ReadOnly);
    }

    #[test]
    fn retained_selection_in_an_inactive_document_cannot_authorize_input() {
        let scoped = text_read_only(Some(false), Some(true), None, false, false);
        assert_eq!(editability(&[scoped], false), Editability::ReadOnly);
        assert_eq!(text_read_only(None, None, None, false, false), None);
    }

    #[test]
    fn verifies_local_insertion_and_replacement_in_large_documents() {
        let start = TextWitness {
            before: "光标前🙂".into(),
            selected: "旧内容".into(),
            after: "光标后".into(),
        };
        let written = TextWitness {
            before: "更远的文档光标前🙂新内容".into(),
            selected: "".into(),
            after: "光标后更远的文档".into(),
        };
        assert!(start.confirms(&written, "新内容"));
        assert!(!start.confirms(&start, "新内容"));
        assert!(!start.confirms(&written, "其他内容"));
        let changed_suffix = TextWitness {
            after: "另一处位置".into(),
            ..written
        };
        assert!(!start.confirms(&changed_suffix, "新内容"));
    }

    #[test]
    fn windows_line_endings_do_not_hide_a_confirmed_multiline_paste() {
        let start = TextWitness {
            before: "前文\r\n".into(),
            selected: String::new(),
            after: "\r\n后文".into(),
        };
        let now = TextWitness {
            before: "前文\r\n第一行\r\n第二行".into(),
            selected: String::new(),
            after: "\r\n后文".into(),
        };
        assert!(start.confirms(&now, "第一行\n第二行"));
        assert!(!start.confirms(&now, "第一行\n其他内容"));
    }
}
