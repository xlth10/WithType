//! Only confirmed WithType insertion ranges are observed; this never writes AX.
use super::{worker_slot::WorkerSlot, *};
use crate::delivery::FocusedCorrectionField;
use std::{
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};
use tauri::Emitter;

// One bounded worker even when an accessibility provider stops responding.
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

pub(crate) fn start_confirmed(
    app: tauri::AppHandle,
    delivered: String,
    session_id: String,
    field: FocusedCorrectionField,
    anchors: Anchors,
    cancelled: Arc<AtomicBool>,
) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    WORKER.cancel();
    if !is_enabled() || delivered.trim().is_empty() || delivered.chars().count() > 12000 {
        return;
    }
    let (control_tx, control_rx) = mpsc::channel();
    if !WORKER.claim(
        generation,
        Instant::now() + Duration::from_millis(100),
        control_tx,
    ) {
        return;
    }
    let guard = WorkerGuard(generation);
    let _ = thread::Builder::new()
        .name("vocabulary-monitor".into())
        .spawn(move || {
            let _worker = guard;
            let started = Instant::now();
            let active = || {
                GENERATION.load(Ordering::SeqCst) == generation
                    && is_enabled()
                    && !cancelled.load(Ordering::SeqCst)
            };
            let mut observation = Observation::new(delivered.clone());
            while active() {
                if !matches!(
                    control_rx.recv_timeout(Duration::from_millis(500)),
                    Err(mpsc::RecvTimeoutError::Timeout)
                ) {
                    return;
                }
                if !active() || started.elapsed() >= Duration::from_secs(60) || !field.is_focused()
                {
                    return;
                }
                let Some(value) = field.read() else {
                    return;
                };
                // Recheck after the remote AX request, including revoked permission.
                if !active() || !field.is_focused() {
                    return;
                }
                match observation.sample(started.elapsed(), true, anchors.segment(&value)) {
                    Observed::Pending => {}
                    Observed::Stop => return,
                    Observed::Correction(edited) => {
                        if active() {
                            let _ = app.emit_to(
                                "main",
                                "vocabulary-correction",
                                Correction {
                                    original: delivered,
                                    edited,
                                    session_id,
                                },
                            );
                        }
                        return;
                    }
                }
            }
        });
}
