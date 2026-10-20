//! Per-delivery observation only. Full field values live on this worker, never on disk.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
static GENERATION: AtomicU64 = AtomicU64::new(0);
static ENABLED: AtomicBool = AtomicBool::new(true);

pub(crate) fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
    if !enabled {
        stop_learning_monitor();
    }
}
#[cfg(any(windows, target_os = "macos"))]
pub(crate) fn is_enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn stop_learning_monitor() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    #[cfg(any(windows, target_os = "macos"))]
    platform::cancel_active();
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningCapability {
    available: bool,
    permission_granted: bool,
    reason: &'static str,
}

/// Reports implementation and permission separately; querying never prompts.
#[tauri::command]
pub fn get_vocabulary_learning_capability() -> LearningCapability {
    #[cfg(target_os = "macos")]
    {
        let permission_granted = crate::delivery::learning_permission_granted();
        LearningCapability {
            available: true,
            permission_granted,
            reason: if permission_granted {
                "ready"
            } else {
                "accessibility_permission_required"
            },
        }
    }
    #[cfg(windows)]
    {
        LearningCapability {
            available: true,
            permission_granted: true,
            reason: "ready",
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        LearningCapability {
            available: false,
            permission_granted: false,
            reason: "platform_unsupported",
        }
    }
}

#[cfg(any(windows, target_os = "macos", test))]
pub(crate) struct Anchors {
    prefix: String,
    suffix: String,
}

#[cfg(any(windows, test))]
pub(crate) fn insertion_confirmed(before: &str, after: &str, delivered: &str) -> bool {
    Anchors::capture(before, after, delivered).is_some()
}
#[cfg(any(windows, target_os = "macos", test))]
impl Anchors {
    /// AX ranges use UTF-16 offsets. Capture the exact verified insertion point,
    /// rather than searching for matching text elsewhere in the field.
    #[cfg(any(target_os = "macos", test))]
    pub(crate) fn from_utf16_range(before: &str, start: usize, length: usize) -> Option<Self> {
        let units: Vec<_> = before.encode_utf16().collect();
        let end = start.checked_add(length)?;
        if end > units.len() {
            return None;
        }
        Some(Self {
            prefix: String::from_utf16(&units[..start]).ok()?,
            suffix: String::from_utf16(&units[end..]).ok()?,
        })
    }
    #[cfg(any(windows, test))]
    fn capture(before: &str, after: &str, delivered: &str) -> Option<Self> {
        if before == after || delivered.trim().is_empty() {
            return None;
        }
        let mut possible = after
            .char_indices()
            .filter(|(start, _)| after[*start..].starts_with(delivered))
            .filter_map(|(start, _)| {
                let prefix = &after[..start];
                let suffix = &after[start + delivered.len()..];
                (prefix.len() + suffix.len() <= before.len()
                    && before.starts_with(prefix)
                    && before.ends_with(suffix))
                .then(|| Self {
                    prefix: prefix.into(),
                    suffix: suffix.into(),
                })
            });
        let anchor = possible.next()?;
        if possible.next().is_some() {
            return None;
        }
        Some(anchor)
    }
    fn segment<'a>(&self, current: &'a str) -> Option<&'a str> {
        current
            .strip_prefix(&self.prefix)?
            .strip_suffix(&self.suffix)
    }
}

#[cfg(any(windows, target_os = "macos", test))]
mod worker_slot {
    use std::sync::{mpsc::Sender, Condvar, Mutex};
    use std::time::Instant;

    pub(super) enum Control {
        Cancel,
        #[cfg(any(windows, test))]
        Pasted(bool),
    }

    #[cfg(any(windows, test))]
    pub struct PasteMonitor {
        pub(super) control: Sender<Control>,
    }
    #[cfg(any(windows, test))]
    impl PasteMonitor {
        pub fn send(&self, pasted: bool) -> Result<(), ()> {
            self.control.send(Control::Pasted(pasted)).map_err(|_| ())
        }
    }

    struct ActiveWorker {
        generation: u64,
        control: Sender<Control>,
    }
    pub(super) struct WorkerSlot {
        active: Mutex<Option<ActiveWorker>>,
        exited: Condvar,
    }
    impl WorkerSlot {
        pub(super) const fn new() -> Self {
            Self {
                active: Mutex::new(None),
                exited: Condvar::new(),
            }
        }
        pub(super) fn cancel(&self) {
            if let Some(worker) = self
                .active
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
            {
                let _ = worker.control.send(Control::Cancel);
            }
        }
        pub(super) fn claim(
            &self,
            generation: u64,
            deadline: Instant,
            control: Sender<Control>,
        ) -> bool {
            let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(worker) = active.as_ref() {
                let _ = worker.control.send(Control::Cancel);
            }
            while active.is_some() {
                let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                    return false;
                };
                let (next, timeout) = self
                    .exited
                    .wait_timeout(active, remaining)
                    .unwrap_or_else(|e| e.into_inner());
                active = next;
                if timeout.timed_out() && active.is_some() {
                    return false;
                }
            }
            if Instant::now() >= deadline {
                return false;
            }
            *active = Some(ActiveWorker {
                generation,
                control,
            });
            true
        }
        pub(super) fn release(&self, generation: u64) {
            let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
            if active
                .as_ref()
                .is_some_and(|worker| worker.generation == generation)
            {
                *active = None;
                self.exited.notify_all();
            }
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::worker_slot::{Control, PasteMonitor, WorkerSlot};
    use super::*;
    use crate::uia::FocusedField;
    use std::{
        sync::mpsc::{self, RecvTimeoutError},
        thread,
        time::{Duration, Instant},
    };
    use tauri::Emitter;
    // A stalled accessibility provider must not accumulate worker threads.
    static WORKER: WorkerSlot = WorkerSlot::new();
    struct WorkerGuard(u64);
    impl Drop for WorkerGuard {
        fn drop(&mut self) {
            WORKER.release(self.0);
        }
    }

    pub(super) fn cancel_active() {
        WORKER.cancel();
    }

    #[derive(Clone, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Correction {
        original: String,
        edited: String,
        session_id: String,
    }

    pub fn prepare(
        app: tauri::AppHandle,
        delivered: String,
        session_id: String,
    ) -> Option<PasteMonitor> {
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        if delivered.chars().count() > 12000 {
            WORKER.cancel();
            return None;
        }
        // The same total budget covers replacing the old worker and capturing the
        // new field. A stalled provider keeps its slot without blocking paste.
        let deadline = Instant::now() + Duration::from_millis(350);
        let (ready_tx, ready_rx) = mpsc::channel();
        let (control_tx, control_rx) = mpsc::channel();
        if !WORKER.claim(generation, deadline, control_tx.clone()) {
            return None;
        }
        let guard = WorkerGuard(generation);
        if GENERATION.load(Ordering::SeqCst) != generation || !is_enabled() {
            return None;
        }
        // Moving the guard also releases the slot if thread creation fails.
        thread::Builder::new()
            .name("vocabulary-monitor".into())
            .spawn(move || {
                let _worker = guard;
                if GENERATION.load(Ordering::SeqCst) != generation || !is_enabled() {
                    return;
                }
                let Some(field) = FocusedField::capture() else {
                    return;
                };
                let Some(before) = field.read() else {
                    return;
                };
                if GENERATION.load(Ordering::SeqCst) != generation || !is_enabled() {
                    return;
                }
                if ready_tx.send(()).is_err() {
                    return;
                }
                if !matches!(
                    control_rx.recv_timeout(Duration::from_secs(2)),
                    Ok(Control::Pasted(true))
                ) {
                    return;
                }
                if !matches!(
                    control_rx.recv_timeout(Duration::from_millis(500)),
                    Err(RecvTimeoutError::Timeout)
                ) {
                    return;
                }
                if GENERATION.load(Ordering::SeqCst) != generation
                    || !is_enabled()
                    || !field.is_focused()
                {
                    return;
                }
                let Some(after) = field.read() else {
                    return;
                };
                let Some(anchors) = Anchors::capture(&before, &after, &delivered) else {
                    return;
                };
                let started = Instant::now();
                let mut observation = Observation::new(delivered.clone());
                let emit_correction = |edited: String| {
                    if edited != delivered
                        && GENERATION.load(Ordering::SeqCst) == generation
                        && is_enabled()
                        && field.is_focused()
                        && GENERATION.load(Ordering::SeqCst) == generation
                        && is_enabled()
                    {
                        let _ = app.emit_to(
                            "main",
                            "vocabulary-correction",
                            Correction {
                                original: delivered.clone(),
                                edited,
                                session_id: session_id.clone(),
                            },
                        );
                    }
                };
                while started.elapsed() < Duration::from_secs(60) {
                    if !matches!(
                        control_rx.recv_timeout(Duration::from_millis(500)),
                        Err(RecvTimeoutError::Timeout)
                    ) {
                        return;
                    }
                    if GENERATION.load(Ordering::SeqCst) != generation || !is_enabled() {
                        return;
                    }
                    if !field.is_focused() {
                        return;
                    }
                    let Some(value) = field.read() else {
                        return;
                    };
                    if GENERATION.load(Ordering::SeqCst) != generation
                        || !is_enabled()
                        || !field.is_focused()
                    {
                        return;
                    }
                    match observation.sample(started.elapsed(), true, anchors.segment(&value)) {
                        Observed::Pending => {}
                        Observed::Stop => return,
                        Observed::Correction(edited) => {
                            emit_correction(edited);
                            return;
                        }
                    }
                }
                // Focus changes and expiry discard unsettled edits.
            })
            .ok()?;
        if ready_rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .is_err()
        {
            let _ = control_tx.send(Control::Cancel);
            return None;
        }
        if GENERATION.load(Ordering::SeqCst) != generation || !is_enabled() {
            let _ = control_tx.send(Control::Cancel);
            return None;
        }
        Some(PasteMonitor {
            control: control_tx,
        })
    }
}
#[cfg(windows)]
pub use platform::prepare;

#[cfg(target_os = "macos")]
#[path = "correction_monitor/macos.rs"]
mod platform;
#[cfg(target_os = "macos")]
pub(crate) use platform::start_confirmed;

/// A correction must remain in the verified range and settle before emission.
/// Focus loss, unreadable values and the absolute deadline never flush drafts.
#[cfg(any(windows, target_os = "macos", test))]
struct Observation {
    original: String,
    last: String,
    changed_at: std::time::Duration,
}
#[cfg(any(windows, target_os = "macos", test))]
#[derive(Debug, PartialEq)]
enum Observed {
    Pending,
    Stop,
    Correction(String),
}
#[cfg(any(windows, target_os = "macos", test))]
impl Observation {
    fn new(original: String) -> Self {
        Self {
            last: original.clone(),
            original,
            changed_at: std::time::Duration::ZERO,
        }
    }
    fn sample(
        &mut self,
        elapsed: std::time::Duration,
        focused: bool,
        segment: Option<&str>,
    ) -> Observed {
        use std::time::Duration;
        if !focused || elapsed >= Duration::from_secs(60) {
            return Observed::Stop;
        }
        let Some(segment) = segment else {
            return Observed::Stop;
        };
        if segment.trim().is_empty() || segment.chars().count() > 12000 {
            return Observed::Stop;
        }
        if segment != self.last {
            self.last = segment.to_owned();
            self.changed_at = elapsed;
        }
        if self.last != self.original
            && elapsed.saturating_sub(self.changed_at) >= Duration::from_secs(4)
        {
            return Observed::Correction(self.last.clone());
        }
        Observed::Pending
    }
}

#[cfg(test)]
mod tests {
    use super::Anchors;
    #[test]
    fn only_inserted_range_is_observed() {
        let a = Anchors::capture("前文后文", "前文徐翔后文", "徐翔").unwrap();
        assert_eq!(a.segment("前文徐相后文"), Some("徐相"));
        assert_eq!(a.segment("改了前文徐相后文"), None);
        assert_eq!(a.segment("前文徐相后文新增"), None);
    }
    #[test]
    fn allows_selection_replacement_but_not_missing_or_ambiguous_insertion() {
        assert!(Anchors::capture("前旧词后", "前新词后", "新词").is_some());
        assert!(Anchors::capture("abc", "abc", "abc").is_none());
        assert!(Anchors::capture("a", "aaa", "aa").is_none());
        assert!(Anchors::capture("a", "xyz", "missing").is_none());
    }

    #[test]
    fn exact_utf16_anchors_support_repeated_text_and_reject_surrogate_splits() {
        let a = Anchors::from_utf16_range("前🙂旧词后", 3, 2).unwrap();
        assert_eq!(a.segment("前🙂徐翔后"), Some("徐翔"));
        assert_eq!(a.segment("前🙂徐相后"), Some("徐相"));
        assert_eq!(a.segment("改了前🙂徐相后"), None);
        let repeated = Anchors::from_utf16_range("aa", 1, 0).unwrap();
        assert_eq!(repeated.segment("aaaa"), Some("aa"));
        assert!(Anchors::from_utf16_range("🙂", 1, 0).is_none());
        assert!(Anchors::from_utf16_range("abc", 2, 8).is_none());
        assert!(Anchors::from_utf16_range("abc", usize::MAX, 1).is_none());
    }

    #[test]
    fn correction_requires_four_seconds_stable_in_the_same_focused_range() {
        use super::{Observation, Observed};
        use std::time::Duration;
        let mut o = Observation::new("徐相".into());
        assert_eq!(
            o.sample(Duration::from_secs(1), true, Some("徐翔")),
            Observed::Pending
        );
        assert_eq!(
            o.sample(Duration::from_secs(4), true, Some("徐翔")),
            Observed::Pending
        );
        assert_eq!(
            o.sample(Duration::from_secs(5), true, Some("徐翔")),
            Observed::Correction("徐翔".into())
        );
        let mut o = Observation::new("徐相".into());
        o.sample(Duration::from_secs(1), true, Some("徐翔"));
        o.sample(Duration::from_secs(3), true, Some("徐翔项目"));
        assert_eq!(
            o.sample(Duration::from_secs(5), true, Some("徐翔项目")),
            Observed::Pending
        );
        assert_eq!(
            o.sample(Duration::from_secs(7), true, Some("徐翔项目")),
            Observed::Correction("徐翔项目".into())
        );
    }

    #[test]
    fn focus_loss_timeout_unreadable_or_invalid_range_does_not_flush_drafts() {
        use super::{Observation, Observed};
        use std::time::Duration;
        for (elapsed, focused, segment) in [
            (5, false, Some("徐翔")),
            (60, true, Some("徐翔")),
            (5, true, None),
            (5, true, Some("  ")),
        ] {
            let mut o = Observation::new("徐相".into());
            o.sample(Duration::from_secs(1), true, Some("徐翔"));
            assert_eq!(
                o.sample(Duration::from_secs(elapsed), focused, segment),
                Observed::Stop
            );
        }
        let mut o = Observation::new("徐相".into());
        assert_eq!(
            o.sample(Duration::from_secs(1), true, Some(&"长".repeat(12001))),
            Observed::Stop
        );
    }

    #[test]
    fn reverted_correction_or_unchanged_delivery_never_emits() {
        use super::{Observation, Observed};
        use std::time::Duration;
        let mut o = Observation::new("徐相".into());
        o.sample(Duration::from_secs(1), true, Some("徐翔"));
        o.sample(Duration::from_secs(2), true, Some("徐相"));
        assert_eq!(
            o.sample(Duration::from_secs(8), true, Some("徐相")),
            Observed::Pending
        );
        assert_eq!(
            o.sample(Duration::from_secs(59), true, Some("徐相")),
            Observed::Pending
        );
    }
    #[test]
    fn next_delivery_wakes_and_replaces_previous_worker() {
        use super::worker_slot::{Control, WorkerSlot};
        use std::{
            sync::{mpsc, Arc},
            thread,
            time::{Duration, Instant},
        };
        let slot = Arc::new(WorkerSlot::new());
        let (tx, rx) = mpsc::channel();
        assert!(slot.claim(1, Instant::now() + Duration::from_secs(1), tx));
        let previous = slot.clone();
        let worker = thread::spawn(move || {
            assert!(matches!(
                rx.recv_timeout(Duration::from_secs(2)),
                Ok(Control::Cancel)
            ));
            previous.release(1);
        });
        let (next_tx, _next_rx) = mpsc::channel();
        assert!(slot.claim(2, Instant::now() + Duration::from_secs(1), next_tx));
        slot.release(2);
        worker.join().unwrap();
    }

    #[test]
    fn stalled_provider_cannot_spawn_extra_workers_or_block_forever() {
        use super::worker_slot::WorkerSlot;
        use std::{
            sync::mpsc,
            time::{Duration, Instant},
        };
        let slot = WorkerSlot::new();
        let (first_tx, _first_rx) = mpsc::channel();
        assert!(slot.claim(1, Instant::now() + Duration::from_secs(1), first_tx));
        let (next_tx, _next_rx) = mpsc::channel();
        assert!(!slot.claim(2, Instant::now() + Duration::from_millis(10), next_tx));
        // A stale worker cannot release a newer worker's slot.
        slot.release(2);
        let (retry_tx, _retry_rx) = mpsc::channel();
        assert!(!slot.claim(3, Instant::now() + Duration::from_millis(10), retry_tx));
        slot.release(1);
    }

    #[test]
    fn paste_result_and_cancellation_share_interruptible_channel() {
        use super::worker_slot::{Control, PasteMonitor, WorkerSlot};
        use std::{
            sync::mpsc,
            time::{Duration, Instant},
        };
        let slot = WorkerSlot::new();
        let (tx, rx) = mpsc::channel();
        assert!(slot.claim(1, Instant::now() + Duration::from_secs(1), tx.clone()));
        let monitor = PasteMonitor { control: tx };
        monitor.send(true).unwrap();
        assert!(matches!(rx.recv().unwrap(), Control::Pasted(true)));
        slot.cancel();
        assert!(matches!(rx.recv().unwrap(), Control::Cancel));
        slot.release(1);
    }
}
