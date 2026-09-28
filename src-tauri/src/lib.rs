mod correction_monitor;
mod skills;
mod text_api;
#[cfg(windows)]
mod uia;
mod vocabulary;

use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const SERVICE_NAME: &str = "app.typefree.windows.unofficial";
const ACCOUNT_NAME: &str = "qwen-asr-api-key";

/// 与前端 src/text/settingsMigration.js 的默认值一致。
const DEFAULT_DICTATION_SHORTCUT: &str = "Ctrl+Alt+Space";
const DEFAULT_ASK_SHORTCUT: &str = "Ctrl+Alt+Shift+Space";
const DEFAULT_ACTION_SHORTCUT: &str = "Ctrl+Alt+Shift+T";

/// 当前实际注册成功的三个组合。
///
/// 记着「注册成功的值」而不是「配置里的值」很重要：注册失败（被别的程序占用）时
/// 两者会不一致，如果按配置去 unregister，就会去注销一个从未注册过的快捷键而报错，
/// 连带把其他好用的键也搞坏。
///
/// 名字不能叫 ShortcutState：插件里已经有一个同名的枚举（按键的按下/抬起状态）。
#[derive(Default)]
struct ShortcutRegistry(Mutex<RegisteredShortcuts>);

#[derive(Default)]
struct ShortcutCaptureState(AtomicBool);

#[derive(Default, Clone)]
struct RegisteredShortcuts {
    dictation: String,
    ask: String,
    action: String,
}

#[derive(Default)]
struct AnswerCardState(Mutex<Option<AnswerCardData>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnswerCardData {
    question: String,
    answer: String,
}

/// 把配置里的字符串和插件回调拿到的 Shortcut 对比。
/// 直接比字符串不可靠：插件回传的格式未必与用户填写的大小写、顺序完全一致。
fn matches_shortcut(shortcut: &Shortcut, value: &str) -> bool {
    value
        .parse::<Shortcut>()
        .map(|parsed| &parsed == shortcut)
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeRequest {
    audio_base64: String,
    filename: String,
    endpoint: String,
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeResponse {
    text: String,
    duration_ms: u128,
}

/// 只保存在本机历史中；不随音频或文字请求发送到模型服务。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveWindowContext {
    app: String,
    title: String,
}

#[cfg(target_os = "windows")]
fn active_window_context() -> Option<ActiveWindowContext> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        },
    };

    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return None;
        }
        let title_len = GetWindowTextLengthW(window).max(0).min(160) as usize;
        let mut title_buf = vec![0u16; title_len + 1];
        let copied = GetWindowTextW(window, title_buf.as_mut_ptr(), title_buf.len() as i32);
        let title = String::from_utf16_lossy(&title_buf[..copied.max(0) as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(window, &mut pid);
        let mut app = String::new();
        if pid != 0 {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !process.is_null() {
                let mut path_buf = vec![0u16; 1024];
                let mut path_len = path_buf.len() as u32;
                if QueryFullProcessImageNameW(process, 0, path_buf.as_mut_ptr(), &mut path_len) != 0
                {
                    let path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
                    let file = path.rsplit(['\\', '/']).next().unwrap_or("");
                    app = file.strip_suffix(".exe").unwrap_or(file).to_string();
                }
                CloseHandle(process);
            }
        }
        if app.is_empty() && title.is_empty() {
            None
        } else {
            Some(ActiveWindowContext { app, title })
        }
    }
}

#[tauri::command]
fn get_active_window_context() -> Option<ActiveWindowContext> {
    #[cfg(target_os = "windows")]
    {
        active_window_context()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[tauri::command]
fn get_answer_card(app: AppHandle) -> Option<AnswerCardData> {
    app.state::<AnswerCardState>().0.lock().ok()?.clone()
}

#[tauri::command]
fn show_answer_card(app: AppHandle, question: String, answer: String) -> Result<(), String> {
    let card = AnswerCardData { question, answer };
    *app.state::<AnswerCardState>()
        .0
        .lock()
        .map_err(|error| error.to_string())? = Some(card.clone());
    if let Some(window) = app.get_webview_window("answer") {
        if let Some(monitor) = window
            .current_monitor()
            .map_err(|error| error.to_string())?
        {
            let scale = monitor.scale_factor();
            let size = window.outer_size().map_err(|error| error.to_string())?;
            let position = monitor.position();
            let screen = monitor.size();
            let margin = (28.0 * scale).round() as i32;
            let x = position.x + screen.width as i32 - size.width as i32 - margin;
            let y = position.y + margin;
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|error| error.to_string())?;
        }
        window.show().map_err(|error| error.to_string())?;
        window
            .emit("ask-answer", card)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_answer_card(app: AppHandle) -> Result<(), String> {
    *app.state::<AnswerCardState>()
        .0
        .lock()
        .map_err(|error| error.to_string())? = None;
    if let Some(window) = app.get_webview_window("answer") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn api_key() -> Result<String, String> {
    keyring::Entry::new(SERVICE_NAME, ACCOUNT_NAME)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?
        .get_password()
        .map_err(|_| "尚未保存 ASR API Key".to_string())
}

fn api_url(endpoint: &str, path: &str) -> String {
    format!(
        "{}/{}",
        endpoint.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

#[tauri::command]
fn save_api_key(key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Ok(());
    }
    keyring::Entry::new(SERVICE_NAME, ACCOUNT_NAME)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?
        .set_password(key.trim())
        .map_err(|error| format!("保存 API Key 失败：{error}"))
}

#[tauri::command]
async fn test_connection(endpoint: String) -> Result<(), String> {
    let started = Instant::now();
    let response = reqwest::Client::new()
        .get(api_url(&endpoint, "models"))
        .bearer_auth(api_key()?)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|error| format!("无法连接 ASR 服务：{error}"))?;

    if !response.status().is_success() {
        return Err(format!("ASR 服务返回 HTTP {}", response.status()));
    }
    if started.elapsed() > Duration::from_secs(8) {
        return Err("ASR 服务响应超时".into());
    }
    Ok(())
}

#[tauri::command]
async fn transcribe_audio(request: TranscribeRequest) -> Result<TranscribeResponse, String> {
    let started = Instant::now();
    let audio = STANDARD
        .decode(request.audio_base64)
        .map_err(|error| format!("录音数据无效：{error}"))?;

    // 前端上传的是自己打包的 WAV（见 src/dictation/wav.js 的 encodeWav）。
    // 这里必须跟着写 audio/wav：服务端解析时长时会看 Content-Type，
    // 若仍标成 audio/webm 会再次走 EBML 分支并抛 500。
    let part = reqwest::multipart::Part::bytes(audio)
        .file_name(request.filename)
        .mime_str("audio/wav")
        .map_err(|error| format!("录音格式无效：{error}"))?;
    let form = reqwest::multipart::Form::new()
        .text("model", request.model)
        .part("file", part);

    let response = reqwest::Client::new()
        .post(api_url(&request.endpoint, "audio/transcriptions"))
        .bearer_auth(api_key()?)
        .multipart(form)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|error| format!("语音识别请求失败：{error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取识别结果失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "ASR 服务返回 HTTP {status}：{}",
            body.chars().take(300).collect::<String>()
        ));
    }
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|error| format!("无法解析识别结果：{error}"))?;
    let text = json
        .get("text")
        .and_then(|value| value.as_str())
        .or_else(|| {
            json.pointer("/choices/0/message/content")
                .and_then(|value| value.as_str())
        })
        .unwrap_or_default()
        .trim()
        .to_string();
    if text.is_empty() {
        return Err("ASR 服务没有返回文字".into());
    }
    Ok(TranscribeResponse {
        text,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("settings.json"))
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    correction_monitor::set_enabled(
        settings
            .get("autoLearn")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
    );
    let data = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(settings_path(&app)?, data).map_err(|error| format!("保存设置失败：{error}"))
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let data = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&data).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn send_ctrl_v() -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
    };
    const V_KEY: u16 = 0x56;
    fn key(vk: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
    let mut inputs = [
        key(VK_CONTROL, 0),
        key(V_KEY, 0),
        key(V_KEY, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err("Windows 未接受粘贴按键".into())
    }
}

#[cfg(not(target_os = "windows"))]
fn send_ctrl_v() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn paste_text(
    app: AppHandle,
    text: String,
    learn: Option<bool>,
    session_id: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        correction_monitor::stop_learning_monitor();
        #[cfg(windows)]
        let monitor = if learn == Some(true) && correction_monitor::is_enabled() {
            correction_monitor::prepare(app, text.clone(), session_id.unwrap_or_default())
        } else {
            None
        };
        #[cfg(not(windows))]
        let _ = (app, learn, session_id);
        let result = paste_to_foreground(text);
        #[cfg(windows)]
        if let Some(monitor) = monitor {
            let _ = monitor.send(result.is_ok());
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

fn paste_to_foreground(text: String) -> Result<(), String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|error| format!("无法打开剪贴板：{error}"))?;
    let previous = clipboard.get_text().ok();
    clipboard
        .set_text(text.clone())
        .map_err(|error| format!("复制失败：{error}"))?;
    thread::sleep(Duration::from_millis(70));
    let result = send_ctrl_v();
    let restore_delay = if result.is_ok() { 900 } else { 0 };

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(restore_delay));
        if let Ok(mut current) = arboard::Clipboard::new() {
            if current.get_text().ok().as_deref() == Some(text.as_str()) {
                if let Some(previous) = previous {
                    let _ = current.set_text(previous);
                }
            }
        }
    });
    result
}

/// 只替换目标键：
/// 先把新键注册成功，再注销旧键；新键注册失败时保持旧键不动并报错。
/// 这样用户改一个键失败，另一个键不会连带失效。
fn replace_shortcut(app: &AppHandle, kind: &str, value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("快捷键不能为空".into());
    }
    let manager = app.global_shortcut();
    let state = app.state::<ShortcutRegistry>();
    let mut registered = state.inner().0.lock().map_err(|error| error.to_string())?;

    let (old, others) = match kind {
        "dictation" => (
            registered.dictation.clone(),
            vec![registered.ask.clone(), registered.action.clone()],
        ),
        "ask" => (
            registered.ask.clone(),
            vec![registered.dictation.clone(), registered.action.clone()],
        ),
        "action" => (
            registered.action.clone(),
            vec![registered.dictation.clone(), registered.ask.clone()],
        ),
        _ => return Err("未知的快捷键类型".into()),
    };

    // 三个入口的组合键必须互不相同。
    for other in others.into_iter().filter(|value| !value.is_empty()) {
        let same = other
            .parse::<Shortcut>()
            .ok()
            .zip(trimmed.parse::<Shortcut>().ok())
            .map(|(a, b)| a == b)
            .unwrap_or_else(|| other == trimmed);
        if same {
            return Err("三个入口不能使用同一个快捷键".into());
        }
    }

    if old == trimmed {
        return Ok(());
    }

    manager
        .register(trimmed)
        .map_err(|error| format!("快捷键「{trimmed}」不可用：{error}"))?;

    // 新键已经生效，这时才动旧键；旧键注销失败不影响结果，只是留下一个多余绑定。
    if !old.is_empty() && old != trimmed {
        let _ = manager.unregister(old.as_str());
    }

    match kind {
        "dictation" => registered.dictation = trimmed.to_string(),
        "ask" => registered.ask = trimmed.to_string(),
        "action" => registered.action = trimmed.to_string(),
        _ => unreachable!(),
    }
    Ok(())
}

#[tauri::command]
fn set_shortcut(app: AppHandle, key: String, value: String) -> Result<(), String> {
    replace_shortcut(&app, &key, &value)
}

#[tauri::command]
fn set_shortcut_capture_active(app: AppHandle, active: bool) {
    app.state::<ShortcutCaptureState>()
        .0
        .store(active, Ordering::SeqCst);
}

/// 启动时按保存的配置一次性注册三个键。
///
/// 刻意不再用 unregister_all()：它会连「上一个键」之后用户手工加的其它绑定一起抹掉，
/// 而且失败时无法区分是哪一个键的问题。
fn register_shortcuts(app: &AppHandle, dictation: &str, ask: &str, action: &str) -> Vec<String> {
    let mut notices = Vec::new();
    if let Err(error) = replace_shortcut(app, "dictation", dictation) {
        notices.push(error);
    }
    if let Err(error) = replace_shortcut(app, "ask", ask) {
        notices.push(error);
    }
    if let Err(error) = replace_shortcut(app, "action", action) {
        notices.push(error);
    }
    if !notices.is_empty() {
        // 回退到默认值，保证至少有一个可用入口，同时让前端能提示用户。
        let _ = replace_shortcut(app, "dictation", DEFAULT_DICTATION_SHORTCUT);
    }
    notices
}

/// 悬浮窗状态。只发状态串不够用：用户需要一眼分清这次是普通口述还是语音命令，
/// 以及「正在识别」「正在整理文字」「正在生成内容」这三件不同的事。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayState {
    state: String,
    intent: String,
    phase: String,
}

#[tauri::command]
fn set_overlay_state(
    app: AppHandle,
    state: String,
    intent: Option<String>,
    phase: Option<String>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overlay") {
        window
            .emit(
                "dictation-state",
                OverlayState {
                    state: state.clone(),
                    intent: intent.unwrap_or_default(),
                    phase: phase.unwrap_or_default(),
                },
            )
            .map_err(|error| error.to_string())?;
        if state == "idle" {
            window.hide().map_err(|error| error.to_string())?;
        } else {
            if let Some(monitor) = window
                .current_monitor()
                .map_err(|error| error.to_string())?
            {
                let monitor_size = monitor.size();
                let monitor_position = monitor.position();
                let window_size = window.outer_size().map_err(|error| error.to_string())?;
                let bottom_margin = (44.0 * monitor.scale_factor()).round() as i32;
                let x =
                    monitor_position.x + (monitor_size.width as i32 - window_size.width as i32) / 2;
                let y = monitor_position.y + monitor_size.height as i32
                    - window_size.height as i32
                    - bottom_margin;
                window
                    .set_position(PhysicalPosition::new(x, y))
                    .map_err(|error| error.to_string())?;
            }
            window.show().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 读取配置里的一个字符串字段。启动阶段要用它决定注册哪两个快捷键，
/// 所以不经过 load_settings 命令，直接读文件。
fn settings_field(settings: &serde_json::Value, key: &str, fallback: &str) -> String {
    settings
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

pub fn run() {
    tauri::Builder::default()
        .manage(ShortcutRegistry::default())
        .manage(ShortcutCaptureState::default())
        .manage(AnswerCardState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // 必须按「按下的到底是哪个键」分流：三个入口共用一条
                    // toggle-recording 会让用户分不清这次是输入还是命令。
                    let registered = app.state::<ShortcutRegistry>();
                    let (dictation, ask, action) = match registered.inner().0.lock() {
                        Ok(state) => (
                            state.dictation.clone(),
                            state.ask.clone(),
                            state.action.clone(),
                        ),
                        Err(_) => (String::new(), String::new(), String::new()),
                    };
                    if app.state::<ShortcutCaptureState>().0.load(Ordering::SeqCst) {
                        if event.state() != ShortcutState::Pressed {
                            return;
                        }
                        let kind = if matches_shortcut(shortcut, &dictation) {
                            "dictation"
                        } else if matches_shortcut(shortcut, &ask) {
                            "ask"
                        } else {
                            "action"
                        };
                        let _ = app.emit("shortcut-capture-pressed", kind);
                        return;
                    }
                    let kind = if !ask.is_empty() && matches_shortcut(shortcut, &ask) {
                        Some("ask")
                    } else if !action.is_empty() && matches_shortcut(shortcut, &action) {
                        Some("action")
                    } else if !dictation.is_empty() && matches_shortcut(shortcut, &dictation) {
                        Some("dictation")
                    } else {
                        None
                    };
                    if let Some(kind) = kind {
                        if event.state() == ShortcutState::Pressed {
                            let _ = app.emit(format!("toggle-{kind}").as_str(), ());
                        }
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let saved = load_settings(handle.clone()).unwrap_or(serde_json::json!({}));
            correction_monitor::set_enabled(
                saved
                    .get("autoLearn")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true),
            );
            let dictation = settings_field(&saved, "shortcut", DEFAULT_DICTATION_SHORTCUT);
            let ask = settings_field(&saved, "askShortcut", DEFAULT_ASK_SHORTCUT);
            let legacy_command = settings_field(&saved, "commandShortcut", DEFAULT_ACTION_SHORTCUT);
            let mut action = settings_field(&saved, "actionShortcut", &legacy_command);
            if saved.get("actionShortcut").is_none() && (action == ask || action == dictation) {
                action = DEFAULT_ACTION_SHORTCUT.to_string();
            }
            let notices = register_shortcuts(&handle, &dictation, &ask, &action);
            if !notices.is_empty() {
                // 交给前端在启动后提示；这里不能直接弹窗，启动阶段还没有界面。
                let _ = handle.emit("shortcut-register-failed", notices);
            }

            if let Some(overlay) = app.get_webview_window("overlay") {
                overlay.set_focusable(false)?;
            }

            let record = MenuItemBuilder::with_id("record", "开始 / 结束语音输入").build(app)?;
            let ask_item = MenuItemBuilder::with_id("ask", "随便问").build(app)?;
            let action_item = MenuItemBuilder::with_id("action", "第三个快捷操作").build(app)?;
            let settings = MenuItemBuilder::with_id("settings", "打开设置").build(app)?;
            let cancel = MenuItemBuilder::with_id("cancel", "取消当前录音 / 处理").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出 Typefree Windows").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&record)
                .item(&ask_item)
                .item(&action_item)
                .separator()
                .item(&settings)
                .item(&cancel)
                .separator()
                .item(&quit)
                .build()?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("Typefree Windows · 非官方")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "record" => {
                        let _ = app.emit("toggle-dictation", ());
                    }
                    "ask" => {
                        let _ = app.emit("toggle-ask", ());
                    }
                    "action" => {
                        let _ = app.emit("toggle-action", ());
                    }
                    "settings" => show_main(app),
                    "cancel" => {
                        let _ = app.emit("cancel-recording", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            correction_monitor::stop_learning_monitor,
            vocabulary::load_vocabulary,
            vocabulary::save_vocabulary,
            save_api_key,
            test_connection,
            transcribe_audio,
            save_settings,
            load_settings,
            get_active_window_context,
            get_answer_card,
            show_answer_card,
            hide_answer_card,
            paste_text,
            set_shortcut,
            set_shortcut_capture_active,
            set_overlay_state,
            text_api::save_text_api_key,
            text_api::test_text_connection,
            text_api::process_text,
            skills::load_custom_skills,
            skills::save_custom_skills,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Typefree Windows");
}
