//! Owns target checks, cancellation and clipboard/input effects on one worker.
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
}
impl Delivery {
    fn copied(message: impl Into<String>) -> Self {
        Self {
            status: "copied".into(),
            copied: true,
            pasted: false,
            message: message.into(),
        }
    }
    fn retained(message: impl Into<String>) -> Self {
        Self {
            status: "retained".into(),
            copied: false,
            pasted: false,
            message: message.into(),
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

pub fn capture(id: &str) -> Result<(), String> {
    let flag = token(id);
    if flag.load(Ordering::SeqCst) {
        return Err("输入已取消".into());
    }
    #[cfg(windows)]
    return platform::capture(id.to_owned(), flag);
    #[cfg(not(windows))]
    Ok(())
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
    #[cfg(windows)]
    return platform::deliver(text, id, auto_paste, flag, app, learn);
    #[cfg(not(windows))]
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
                Delivery::copied(if auto_paste {
                    "当前平台未启用自动输入，已复制"
                } else {
                    "已复制，可以粘贴"
                })
            })
            .or_else(|e| Ok(Delivery::retained(format!("复制失败，结果已保留：{e}"))))
    }
}

pub fn caret() -> Option<crate::card_position::Rect> {
    #[cfg(windows)]
    return platform::caret();
    #[cfg(not(windows))]
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
