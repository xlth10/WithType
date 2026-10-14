//! Native ownership of controller readiness and recovery; window visibility is independent.
mod state;
#[cfg(windows)]
mod windows_events;

use serde::Serialize;
use state::{Machine, Phase};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub struct Supervisor {
    state: Mutex<Machine>,
    clock: Instant,
}
impl Default for Supervisor {
    fn default() -> Self {
        Self {
            state: Mutex::new(Machine::default()),
            clock: Instant::now(),
        }
    }
}
impl Supervisor {
    fn now(&self) -> u64 {
        self.clock.elapsed().as_millis() as u64
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub generation: u64,
    pub phase: String,
    pub message: String,
}
fn snapshot(s: &Machine) -> Status {
    Status {
        generation: s.generation,
        phase: s.phase.label().into(),
        message: s.message.clone(),
    }
}
fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("此窗口不是语音控制器".into())
    }
}
fn publish(app: &AppHandle, status: &Status) {
    let _ = app.emit("voice-controller-status", status);
    if let Some(tray) = app.tray_by_id("withtype") {
        let label = match status.phase.as_str() {
            "ready" => "语音输入可用",
            "suspended" => "语音输入已暂停",
            "failed" => "语音输入暂时不可用",
            _ => "语音输入正在准备",
        };
        let _ = tray.set_tooltip(Some(format!("WithType · {label}")));
    }
}

#[tauri::command]
pub fn get_voice_controller(app: AppHandle) -> Result<Status, String> {
    let supervisor = app.state::<Supervisor>();
    let s = supervisor.state.lock().map_err(|e| e.to_string())?;
    Ok(snapshot(&s))
}
#[tauri::command]
pub fn voice_controller_ready(
    app: AppHandle,
    window: WebviewWindow,
    generation: u64,
) -> Result<Status, String> {
    main_only(&window)?;
    let supervisor = app.state::<Supervisor>();
    let status = {
        let mut s = supervisor.state.lock().map_err(|e| e.to_string())?;
        if !s.ready(generation, supervisor.now()) {
            return Err("语音控制器代次已失效或当前会话已暂停".into());
        }
        snapshot(&s)
    };
    publish(&app, &status);
    Ok(status)
}
#[tauri::command]
pub fn voice_controller_pong(app: AppHandle, window: WebviewWindow, generation: u64) -> bool {
    if main_only(&window).is_err() {
        return false;
    }
    let supervisor = app.state::<Supervisor>();
    let accepted = supervisor
        .state
        .lock()
        .map(|mut s| s.pong(generation, supervisor.now()))
        .unwrap_or(false);
    accepted
}
#[tauri::command]
pub fn claim_voice_action(app: AppHandle, window: WebviewWindow, generation: u64, id: u64) -> bool {
    if main_only(&window).is_err() {
        return false;
    }
    let supervisor = app.state::<Supervisor>();
    let accepted = supervisor
        .state
        .lock()
        .map(|mut s| s.claim(generation, id, supervisor.now()))
        .unwrap_or(false);
    accepted
}
#[tauri::command]
pub fn track_voice_task(
    app: AppHandle,
    window: WebviewWindow,
    generation: u64,
    task_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    if task_id.is_empty() || task_id.len() > 100 {
        return Err("语音任务 ID 无效".into());
    }
    let supervisor = app.state::<Supervisor>();
    let accepted = supervisor
        .state
        .lock()
        .map_err(|e| e.to_string())?
        .track(generation, task_id);
    if accepted {
        Ok(())
    } else {
        Err("语音输入正在恢复，请重新开始任务".into())
    }
}
#[tauri::command]
pub fn finish_voice_task(app: AppHandle, window: WebviewWindow, generation: u64, task_id: String) {
    if main_only(&window).is_err() {
        return;
    }
    let supervisor = app.state::<Supervisor>();
    if let Ok(mut s) = supervisor.state.lock() {
        if generation == s.generation {
            s.tasks.remove(&task_id);
        }
    };
}
#[tauri::command]
pub fn voice_controller_unavailable(
    app: AppHandle,
    window: WebviewWindow,
    generation: u64,
    message: String,
) {
    if main_only(&window).is_err() {
        return;
    }
    let supervisor = app.state::<Supervisor>();
    let transition = {
        let Ok(mut s) = supervisor.state.lock() else {
            return;
        };
        if generation != s.generation || s.phase == Phase::Stopped {
            return;
        }
        let tasks = s.invalidate(
            Phase::Failed,
            supervisor.now(),
            message.chars().take(300).collect(),
        );
        (tasks, snapshot(&s))
    };
    interrupt(&app, transition.0);
    notify_reset(&app, &transition.1);
}
pub fn note(app: &AppHandle, message: String) {
    let supervisor = app.state::<Supervisor>();
    let status = supervisor.state.lock().ok().map(|mut s| {
        s.message = message;
        snapshot(&s)
    });
    if let Some(status) = status {
        publish(app, &status);
    }
}
pub fn is_running(app: &AppHandle) -> bool {
    app.state::<Supervisor>()
        .state
        .lock()
        .is_ok_and(|s| s.phase != Phase::Stopped)
}
#[tauri::command]
pub fn voice_controller_dialog(
    app: AppHandle,
    window: WebviewWindow,
    generation: u64,
    active: bool,
) -> Result<(), String> {
    main_only(&window)?;
    let supervisor = app.state::<Supervisor>();
    let accepted = supervisor.state.lock().map_err(|e| e.to_string())?.dialog(
        generation,
        active,
        supervisor.now(),
    );
    if accepted {
        Ok(())
    } else {
        Err("语音输入尚未就绪，请稍后重试".into())
    }
}
pub fn require_task(app: &AppHandle, id: &str) -> Result<(), String> {
    let supervisor = app.state::<Supervisor>();
    let s = supervisor.state.lock().map_err(|e| e.to_string())?;
    if s.phase == Phase::Ready && s.tasks.contains(id) {
        Ok(())
    } else {
        Err("语音任务已中断，请重新开始录音".into())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Action {
    id: u64,
    generation: u64,
    action: String,
    text: Option<String>,
}
pub fn dispatch(app: &AppHandle, action: &str, text: Option<String>) -> Result<(), String> {
    if ![
        "toggle-dictation",
        "toggle-ask",
        "toggle-action",
        "stop-recording",
        "cancel-recording",
        "copy-last-result",
        "insert-result",
    ]
    .contains(&action)
    {
        return Err("未知的语音操作".into());
    }
    if text
        .as_ref()
        .is_some_and(|value| value.chars().count() > 60000)
    {
        return Err("待输入的文字过长".into());
    }
    let supervisor = app.state::<Supervisor>();
    let command = {
        let mut s = supervisor.state.lock().map_err(|e| e.to_string())?;
        if action == "cancel-recording" && s.phase != Phase::Ready {
            drop(s);
            let _ = crate::set_overlay_state(app.clone(), "idle".into(), None, None, None);
            return Ok(());
        }
        let generation = s.generation;
        let id = s
            .issue(supervisor.now())
            .ok_or_else(|| "语音输入尚未就绪，请稍后重试；可从托盘恢复语音输入".to_string())?;
        Action {
            id,
            generation,
            action: action.into(),
            text,
        }
    };
    app.emit_to("main", "voice-action", command)
        .map_err(|e| e.to_string())
}
pub fn trigger(app: &AppHandle, action: &str) {
    if let Err(message) = dispatch(app, action, None) {
        // Native feedback works even if the controller page cannot handle events.
        let _ = crate::set_overlay_state(
            app.clone(),
            "error".into(),
            None,
            Some("background-unavailable".into()),
            None,
        );
        eprintln!("WithType background: {message}");
    }
}
#[tauri::command]
pub fn request_voice_action(
    app: AppHandle,
    action: String,
    text: Option<String>,
) -> Result<(), String> {
    dispatch(&app, &action, text)
}

fn interrupt(app: &AppHandle, tasks: Vec<String>) {
    for id in &tasks {
        crate::delivery::cancel(id);
        crate::text_api::cancel_task_requests(id);
    }
    crate::audio::interrupt_sessions(app.clone(), &tasks);
    crate::correction_monitor::stop_learning_monitor();
    app.state::<crate::ShortcutCaptureState>()
        .0
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let _ = crate::set_interaction_active(app.clone(), false);
    let _ = crate::set_overlay_state(app.clone(), "idle".into(), None, None, None);
}
fn notify_reset(app: &AppHandle, status: &Status) {
    publish(app, status);
    let _ = app.emit_to("main", "voice-controller-reset", status);
}
fn reload(app: &AppHandle) -> bool {
    if let Some(window) = app.get_webview_window("main") {
        match window.reload() {
            Ok(()) => return true,
            Err(error) => eprintln!("WithType controller reload: {error}"),
        }
    }
    false
}
fn recreate(app: &AppHandle, generation: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let current = || {
            app.state::<Supervisor>().state.lock().is_ok_and(|s| {
                s.generation == generation && matches!(s.phase, Phase::Recovering | Phase::Ready)
            })
        };
        if !current() {
            return;
        }
        // Recreate all three views so a failed shared WebView2 browser can be replaced too.
        let mut configs: Vec<_> = app
            .config()
            .app
            .windows
            .iter()
            .filter(|config| ["main", "overlay", "answer"].contains(&config.label.as_str()))
            .cloned()
            .collect();
        // Build supporting views before the controller can advertise readiness.
        configs.sort_by_key(|config| config.label == "main");
        let visible = app
            .get_webview_window("main")
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        for config in &configs {
            if !current() {
                return;
            }
            if let Some(window) = app.get_webview_window(&config.label) {
                let _ = window.destroy();
            }
        }
        for _ in 0..40 {
            if configs
                .iter()
                .all(|config| app.get_webview_window(&config.label).is_none())
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        for config in configs {
            if !current() {
                return;
            }
            let result = tauri::WebviewWindowBuilder::from_config(&app, &config)
                .and_then(|builder| builder.visible(config.label == "main" && visible).build());
            match result {
                Ok(window) => {
                    let _ = window.set_zoom(1.0);
                    if config.label == "overlay" {
                        let _ = window.set_focusable(false);
                    }
                    if let Ok(icon) = crate::app_icon() {
                        let _ = window.set_icon(icon);
                    }
                    if config.label == "main" {
                        if let Ok(Some(monitor)) = window.current_monitor() {
                            let _ = crate::place_floating(
                                &window,
                                &monitor,
                                crate::floating::Surface::Main,
                            );
                        }
                    }
                }
                Err(error) => eprintln!("WithType view recreation: {error}"),
            }
        }
    });
}
pub fn recover(app: &AppHandle, manual: bool) {
    let supervisor = app.state::<Supervisor>();
    let transition = {
        let Ok(mut s) = supervisor.state.lock() else {
            return;
        };
        let recreate_needed = manual || s.phase == Phase::Recovering;
        s.recover(supervisor.now(), manual)
            .map(|tasks| (tasks, snapshot(&s), recreate_needed))
    };
    if let Some((tasks, status, recreate_needed)) = transition {
        interrupt(app, tasks);
        notify_reset(app, &status);
        if status.phase == "recovering" {
            if recreate_needed || !reload(app) {
                recreate(app, status.generation);
            }
        }
    }
}
#[tauri::command]
pub fn recover_voice_controller(app: AppHandle) {
    recover(&app, true);
}

pub fn page_loading(app: &AppHandle) {
    let supervisor = app.state::<Supervisor>();
    let transition = {
        let Ok(mut s) = supervisor.state.lock() else {
            return;
        };
        if s.phase != Phase::Ready {
            return;
        }
        let tasks = s.invalidate(
            Phase::Starting,
            supervisor.now(),
            "语音页面已重新载入，中断的录音可重新转写".into(),
        );
        (tasks, snapshot(&s))
    };
    interrupt(app, transition.0);
    publish(app, &transition.1);
}
pub fn system_pause(app: &AppHandle, sleep: bool, paused: bool) {
    let supervisor = app.state::<Supervisor>();
    let transition = {
        let Ok(mut s) = supervisor.state.lock() else {
            return;
        };
        s.pause(sleep, paused, supervisor.now())
            .map(|tasks| (tasks, snapshot(&s)))
    };
    if let Some((tasks, status)) = transition {
        interrupt(app, tasks);
        let notices = if status.phase == "starting" {
            crate::refresh_shortcuts(app)
        } else {
            Vec::new()
        };
        notify_reset(app, &status);
        if !notices.is_empty() {
            note(app, notices.join(" "));
        }
    }
}
pub fn stop(app: &AppHandle) {
    let supervisor = app.state::<Supervisor>();
    let tasks = supervisor
        .state
        .lock()
        .map(|mut s| s.invalidate(Phase::Stopped, supervisor.now(), String::new()))
        .unwrap_or_default();
    interrupt(app, tasks);
}
pub fn start(app: &AppHandle) {
    #[cfg(windows)]
    windows_events::start(app.clone());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let supervisor = app.state::<Supervisor>();
            let (stopped, paused, timed_out, generation) = {
                let Ok(s) = supervisor.state.lock() else {
                    break;
                };
                (
                    s.phase == Phase::Stopped,
                    s.phase == Phase::Suspended,
                    s.timeout(supervisor.now()),
                    s.generation,
                )
            };
            if stopped {
                break;
            }
            if paused {
                continue;
            }
            if timed_out {
                recover(&app, false);
            } else {
                let _ = app.emit_to("main", "voice-controller-ping", generation);
            }
        }
    });
}
