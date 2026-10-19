//! Owns target checks, cancellation and clipboard/input effects on one worker.
#[path = "delivery/policy.rs"]
pub(crate) mod policy;
use policy::Reason;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub status: String,
    pub copied: bool,
    pub pasted: bool,
    pub message: String,
    pub reason: Reason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<DeliveryDiagnostics>,
}
#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryDiagnostics {
    pub capture_ms: u64,
    pub capture_queue_ms: u64,
    pub verify_ms: u64,
    pub sent_events: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<TargetIdentity>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetIdentity {
    pub window: isize,
    pub child: isize,
    pub process_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_source: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_source: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hresult: Option<i32>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInfo {
    pub reason: Reason,
    pub message: String,
    pub elapsed_ms: u64,
    pub queue_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<TargetIdentity>,
}
impl CaptureInfo {
    fn new(reason: Reason, elapsed_ms: u64) -> Self {
        Self {
            reason,
            message: reason.message().into(),
            elapsed_ms,
            queue_ms: 0,
            target: None,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    session_id: String,
    stage: String,
    reason: Reason,
    elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    sent_events: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<TargetIdentity>,
}
fn records() -> &'static Mutex<VecDeque<Diagnostic>> {
    static RECORDS: OnceLock<Mutex<VecDeque<Diagnostic>>> = OnceLock::new();
    RECORDS.get_or_init(Default::default)
}
fn record(id: &str, stage: &str, reason: Reason, elapsed_ms: u64, sent_events: u32) {
    record_target(id, stage, reason, elapsed_ms, Some(sent_events), None);
}
fn record_target(
    id: &str,
    stage: &str,
    reason: Reason,
    elapsed_ms: u64,
    sent_events: Option<u32>,
    target: Option<TargetIdentity>,
) {
    if let Ok(mut records) = records().lock() {
        if records.len() == 64 {
            records.pop_front();
        }
        records.push_back(Diagnostic {
            session_id: id.chars().take(100).collect(),
            stage: stage.into(),
            reason,
            elapsed_ms,
            sent_events,
            target,
        });
    }
}
pub fn diagnostics() -> Vec<Diagnostic> {
    records()
        .lock()
        .map(|v| v.iter().cloned().collect())
        .unwrap_or_default()
}
impl Delivery {
    fn copied(message: impl Into<String>) -> Self {
        Self {
            status: "copied".into(),
            copied: true,
            pasted: false,
            message: message.into(),
            reason: Reason::CopyRequested,
            diagnostics: None,
        }
    }
    fn retained(message: impl Into<String>) -> Self {
        Self {
            status: "retained".into(),
            copied: false,
            pasted: false,
            message: message.into(),
            reason: Reason::ClipboardFailed,
            diagnostics: None,
        }
    }
}

#[derive(Default)]
struct Cancellations {
    values: HashMap<String, Arc<AtomicBool>>,
    order: VecDeque<String>,
}
impl Cancellations {
    fn token(&mut self, id: &str) -> Arc<AtomicBool> {
        if let Some(token) = self.values.get(id) {
            return token.clone();
        }
        let token = Arc::new(AtomicBool::new(false));
        self.values.insert(id.into(), token.clone());
        self.order.push_back(id.into());
        let mut remaining = self.order.len();
        while self.order.len() > 256 && remaining > 0 {
            remaining -= 1;
            if let Some(old) = self.order.pop_front() {
                if self
                    .values
                    .get(&old)
                    .is_some_and(|v| Arc::strong_count(v) > 1)
                {
                    self.order.push_back(old);
                } else {
                    self.values.remove(&old);
                }
            }
        }
        token
    }
}
fn token(id: &str) -> Arc<AtomicBool> {
    static TOKENS: OnceLock<Mutex<Cancellations>> = OnceLock::new();
    TOKENS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .token(id)
}
pub fn cancel(id: &str) {
    token(id).store(true, Ordering::SeqCst);
}

#[cfg(windows)]
#[path = "delivery/platform.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "delivery/macos.rs"]
mod platform;

pub fn capture(id: &str) -> Result<(), String> {
    capture_target(id, None).map(|_| ())
}

// The native action queues this before its renderer event, without waiting for
// UIA. The one-use token may only be adopted by a registered voice task.
pub fn prime(id: &str) {
    #[cfg(any(windows, target_os = "macos"))]
    platform::prime(id.to_owned(), token(id));
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = id;
}

pub fn capture_target(id: &str, input_token: Option<String>) -> Result<CaptureInfo, String> {
    let flag = token(id);
    if flag.load(Ordering::SeqCst) {
        return Err("输入已取消".into());
    }
    #[cfg(any(windows, target_os = "macos"))]
    return platform::capture(id.to_owned(), flag, input_token);
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = input_token;
        Ok(CaptureInfo::new(Reason::PlatformUnsupported, 0))
    }
}

pub fn deliver(
    text: String,
    id: String,
    auto_paste: bool,
    app: tauri::AppHandle,
    learn: bool,
) -> Result<Delivery, String> {
    let flag = token(&id);
    if flag.load(Ordering::SeqCst) {
        return Err("输入已取消".into());
    }
    #[cfg(any(windows, target_os = "macos"))]
    return platform::deliver(text, id, auto_paste, flag, app, learn);
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, learn);
        static SERIAL: Mutex<()> = Mutex::new(());
        let _serial = SERIAL.lock().map_err(|e| e.to_string())?;
        if flag.load(Ordering::SeqCst) {
            return Err("输入已取消".into());
        }
        arboard::Clipboard::new()
            .and_then(|mut c| c.set_text(text))
            .map(|_| {
                let mut result = Delivery::copied(if auto_paste {
                    "当前平台未启用自动输入，已复制"
                } else {
                    "已复制，可以粘贴"
                });
                if auto_paste {
                    result.reason = Reason::PlatformUnsupported;
                }
                result
            })
            .or_else(|e| Ok(Delivery::retained(format!("复制失败，结果已保留：{e}"))))
    }
}

pub fn caret() -> Option<crate::card_position::Rect> {
    #[cfg(any(windows, target_os = "macos"))]
    return platform::caret();
    #[cfg(not(any(windows, target_os = "macos")))]
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancel_before_registration_does_not_revive_and_active_token_survives_eviction() {
        let mut c = Cancellations::default();
        c.token("cancelled").store(true, Ordering::SeqCst);
        assert!(c.token("cancelled").load(Ordering::SeqCst));
        let active = c.token("active");
        for i in 0..300 {
            c.token(&format!("later-{i}"));
        }
        c.token("active").store(true, Ordering::SeqCst);
        assert!(active.load(Ordering::SeqCst));
        assert_eq!(c.values.len(), 256);
    }
}
