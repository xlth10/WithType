mod audio;
mod correction_monitor;
mod floating;
mod history;
mod skills;
mod startup;
mod text_api;
#[cfg(windows)]
mod uia;
mod vocabulary;

use std::{
    collections::HashSet,
    fs,
    future::Future,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const SERVICE_NAME: &str = "app.typefree.windows.unofficial";
const ACCOUNT_NAME: &str = "qwen-asr-api-key";

#[derive(Default)]
struct PasteSessions {
    active: HashSet<String>,
    cancelled: HashSet<String>,
}

static PASTE_SESSIONS: OnceLock<Mutex<PasteSessions>> = OnceLock::new();

/// 托盘和窗口标题栏用的图标。
///
/// 不能用 `app.default_window_icon()`：Windows 上它取自 `icons/ink-v2/icon.ico`，
/// 而 tauri-codegen 解析 ICO 时写死了 `entries()[0]`，也就是目录里的第一帧 ——
/// 按 scripts/generate_ink_icon.py 的写入顺序恰好是 16×16。这个 16px 位图随后被
/// tao / tray-icon 原样交给 CreateIcon（不缩放），DPI 放大后就糊了。
///
/// 这里嵌的是整个 icon.ico：`tauri::Image::from_bytes` 走 image crate 的
/// ico 解码器，它按「位深优先、再比面积」挑帧，会选到 256×256 那帧，
/// 而不是像 tauri-codegen 那样只认第一帧。
///
/// 之所以用 .ico 而不是 128×128.png：本机 DLP 会把 .png 就地加密成
/// %TSD-Header-###%，编译期 include_bytes! 读到的就是密文（.ico 不受影响），
/// 运行时再读盘则要依赖解密，所以宁可嵌裸的 .ico 字节。
static APP_ICON: &[u8] = include_bytes!("../icons/ink-v2/icon.ico");

fn app_icon() -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(APP_ICON)
}

fn paste_sessions() -> &'static Mutex<PasteSessions> {
    PASTE_SESSIONS.get_or_init(|| Mutex::new(PasteSessions::default()))
}

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
struct AnswerCardState(Mutex<AnswerCardSession>);
#[derive(Default)]
struct AnswerCardSession {
    card: Option<AnswerCardData>,
    closed_request_id: Option<String>,
}

#[derive(Default)]
struct FloatingContext {
    monitor: Option<tauri::Monitor>,
    overlay_state: String,
}
#[derive(Default)]
struct FloatingContextState(Mutex<FloatingContext>);

fn cursor_monitor(window: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    window
        .cursor_position()
        .ok()
        .and_then(|point| window.monitor_from_point(point.x, point.y).ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten())
}

fn floating_monitor(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    new_session: bool,
) -> Option<tauri::Monitor> {
    let state = app.state::<FloatingContextState>();
    let mut context = state.0.lock().ok()?;
    // Resolve on entry, retain throughout recording and processing. Moving the
    // pointer during an upload must not move the HUD or the resulting card.
    let monitors = window.available_monitors().ok().unwrap_or_default();
    let retained = context.monitor.as_ref().and_then(|old| {
        monitors
            .iter()
            .find(|item| item.position() == old.position() && item.name() == old.name())
            .cloned()
    });
    let monitor = if new_session {
        cursor_monitor(window)
    } else {
        retained.or_else(|| cursor_monitor(window))
    };
    context.monitor = monitor.clone();
    monitor
}

fn place_floating(
    window: &tauri::WebviewWindow,
    monitor: &tauri::Monitor,
    surface: floating::Surface,
) -> Result<(), String> {
    let work = monitor.work_area();
    let area = floating::WorkArea {
        x: work.position.x,
        y: work.position.y,
        width: work.size.width,
        height: work.size.height,
        scale: monitor.scale_factor(),
    };
    let mut geometry = floating::geometry(area, surface);
    // Moving first lets Windows change monitor DPI; the explicit target physical
    // size then overrides the automatic WM_DPICHANGED suggested rectangle.
    window
        .set_position(PhysicalPosition::new(geometry.x, geometry.y))
        .map_err(|e| e.to_string())?;
    // Preserve the 1060×720 logical WebView content area when it fits. Native
    // borders are additional space; only shrink content when the total window
    // would exceed the target work area (e.g. a high-DPI laptop).
    let (width, height) = if matches!(surface, floating::Surface::Main) {
        let outer = window.outer_size().map_err(|e| e.to_string())?;
        let inner = window.inner_size().map_err(|e| e.to_string())?;
        let frame_width = outer.width.saturating_sub(inner.width);
        let frame_height = outer.height.saturating_sub(inner.height);
        geometry = floating::main_geometry(area, frame_width, frame_height);
        (
            geometry.width.saturating_sub(frame_width).max(1),
            geometry.height.saturating_sub(frame_height).max(1),
        )
    } else {
        (geometry.width, geometry.height)
    };
    let minimum = match surface {
        floating::Surface::Main => Some((640.0, 480.0)),
        floating::Surface::Card => Some((360.0, 320.0)),
        floating::Surface::Hud => None,
    };
    if let Some((min_width, min_height)) = minimum {
        let scale = monitor.scale_factor();
        window
            .set_min_size(Some(PhysicalSize::new(
                ((min_width * scale).round() as u32).min(width),
                ((min_height * scale).round() as u32).min(height),
            )))
            .map_err(|e| e.to_string())?;
    }
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(geometry.x, geometry.y))
        .map_err(|e| e.to_string())?;
    debug_log(&format!(
        "floating: work=({},{}) {}x{} scale={} -> {:?}",
        work.position.x,
        work.position.y,
        work.size.width,
        work.size.height,
        monitor.scale_factor(),
        geometry
    ));
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnswerCardData {
    question: String,
    answer: String,
    request_id: Option<String>,
    kind: String,
    title: String,
    streaming: bool,
    error: Option<String>,
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
pub(crate) struct TranscribeResponse {
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

/// 双 bug 排查用的临时诊断日志，写到系统临时目录的 typefree-debug.log。
/// 定位完成后会移除，不是正式日志设施：不记正文内容，只记定位需要的窗口与按键事实。
fn debug_log(message: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join("typefree-debug.log");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default();
            writeln!(
                file,
                "[{:?}+{:03}ms] {}",
                now.as_secs(),
                now.subsec_millis(),
                message
            )
        });
}

/// 悬浮窗的 show() 在第二次起走 SW_SHOW 会激活自己；粘贴键打到的是前台窗口，
/// 所以显示前后都要看住前台，被抢走就还给用户正在打字的应用。
#[cfg(target_os = "windows")]
fn foreground_window() -> windows_sys::Win32::Foundation::HWND {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe { GetForegroundWindow() }
}

#[cfg(target_os = "windows")]
fn restore_foreground(window: windows_sys::Win32::Foundation::HWND, scenario: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};
    if window.is_null() {
        return;
    }
    let current = unsafe { GetForegroundWindow() };
    if current != window {
        debug_log(&format!(
            "{scenario}: 前台 {:p} 被换成 {:p}，SetForegroundWindow 恢复 = {}",
            window,
            current,
            unsafe { SetForegroundWindow(window) } != 0
        ));
    }
}

/// Ctrl+V 只打前台窗口。悬浮 HUD 的 show() 第二次起是 SW_SHOW（会激活自己），
/// 且 tao 的 force_window_active 失败时还会发 Alt 键 hack——两者都可能把前台
/// 挪走，粘贴就打错了地方。粘贴前确认前台还是启动口述时的那个应用；不是的话
/// 直接把前台还给那个窗口，再发键。
#[cfg(target_os = "windows")]
fn paste_focus_note() -> Option<isize> {
    let hwnd = foreground_window();
    if hwnd.is_null() {
        debug_log("paste_focus: 启动口述时前台窗口为空");
        return None;
    }
    Some(hwnd as isize)
}

#[cfg(target_os = "windows")]
fn paste_focus_restore(hwnd: Option<isize>, scenario: &str) {
    let Some(hwnd) = hwnd else { return };
    restore_foreground(hwnd as windows_sys::Win32::Foundation::HWND, scenario);
}

#[cfg(target_os = "windows")]
fn paste_focus_force(window: isize) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
    let ok = unsafe { SetForegroundWindow(window as windows_sys::Win32::Foundation::HWND) };
    ok != 0
}

#[tauri::command]
fn get_answer_card(app: AppHandle) -> Option<AnswerCardData> {
    app.state::<AnswerCardState>().0.lock().ok()?.card.clone()
}

#[tauri::command]
fn show_answer_card(
    app: AppHandle,
    question: String,
    answer: String,
    request_id: Option<String>,
    kind: Option<String>,
    title: Option<String>,
    streaming: Option<bool>,
    error: Option<String>,
) -> Result<(), String> {
    let card = AnswerCardData {
        question,
        answer,
        request_id,
        kind: kind.unwrap_or_else(|| "ask".into()),
        title: title.unwrap_or_else(|| "随便问".into()),
        streaming: streaming.unwrap_or(false),
        error,
    };
    let changed = {
        let state = app.state::<AnswerCardState>();
        let mut current = state.0.lock().map_err(|e| e.to_string())?;
        // A late final response cannot reopen a card the user dismissed.
        if card.request_id.is_some() && current.closed_request_id == card.request_id {
            return Ok(());
        }
        let changed = current
            .card
            .as_ref()
            .map(|old| (&old.request_id, &old.question))
            != Some((&card.request_id, &card.question));
        current.card = Some(card.clone());
        changed
    };
    if let Some(window) = app.get_webview_window("answer") {
        if changed {
            if let Some(monitor) = floating_monitor(&app, &window, false) {
                place_floating(&window, &monitor, floating::Surface::Card)?;
            }
        }
        window.emit("ask-answer", card).map_err(|e| e.to_string())?;
        if !window.is_visible().map_err(|e| e.to_string())? {
            window.show().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn hide_answer_card(app: AppHandle, request_id: Option<String>) -> Result<(), String> {
    {
        let state = app.state::<AnswerCardState>();
        let mut current = state.0.lock().map_err(|error| error.to_string())?;
        if request_id.is_some()
            && current
                .card
                .as_ref()
                .and_then(|card| card.request_id.as_ref())
                != request_id.as_ref()
        {
            return Ok(());
        }
        current.closed_request_id = current.card.take().and_then(|card| card.request_id);
    }
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
    let base = endpoint.trim().trim_end_matches('/');
    let suffix = path.trim_start_matches('/');
    if base.ends_with(&format!("/{suffix}")) {
        base.to_string()
    } else {
        format!("{base}/{suffix}")
    }
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

/// 探针音频的形状：1 秒 16 kHz 单声道 PCM16 的 440 Hz 低幅正弦。
///
/// 时长维持 1 秒是有实测依据的——1 秒正弦在该上游稳定返回 200。
/// 幅度只为避开「整段数字静音」这一个会稳定触发 500 的输入；
/// 不要拿它去和 audio.rs 里 pause_end / has_voice 的录音阈值（0.008 / 0.012）比较，
/// 那判的是「录音里有没有人声」，比「上游能不能解码出文字」严得多。
const PROBE_RATE: u32 = 16_000;
const PROBE_SAMPLES: usize = PROBE_RATE as usize;
const PROBE_AMPLITUDE: f32 = 0.1;
const PROBE_TONE_HZ: f32 = 440.0;

/// 合成探针 WAV。复用 audio::wav_bytes，避免两套 RIFF 头各自漂移。
fn probe_wav() -> Result<Vec<u8>, String> {
    let samples: Vec<f32> = (0..PROBE_SAMPLES)
        .map(|index| {
            let phase =
                2.0 * std::f32::consts::PI * PROBE_TONE_HZ * index as f32 / PROBE_RATE as f32;
            PROBE_AMPLITUDE * phase.sin()
        })
        .collect();
    audio::wav_bytes(&samples)
}

#[tauri::command]
async fn test_connection(endpoint: String, model: String) -> Result<(), String> {
    if endpoint.trim().is_empty() || model.trim().is_empty() {
        return Err("请先填写 ASR 地址和模型名称".into());
    }
    // 通用转录服务不一定暴露 GET /models，所以用一次真实的 audio/transcriptions
    // 调用验证协议。载荷必须是有内容的音频：整段数字静音在该上游会被判成
    // 「没有解码出文字」而稳定返回 HTTP 500。
    let part = reqwest::multipart::Part::bytes(probe_wav()?)
        .file_name("connection-test.wav")
        .mime_str("audio/wav")
        .map_err(|error| format!("无法准备测试 WAV：{error}"))?;
    let form = reqwest::multipart::Form::new()
        .text("model", model)
        .part("file", part);
    let response = text_api::client()
        .post(api_url(&endpoint, "audio/transcriptions"))
        .bearer_auth(api_key()?)
        .multipart(form)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|error| format!("无法连接 ASR 服务：{error}"))?;

    let status = response.status();
    // 先把 body 读出来再判状态——response.json() 会消耗掉响应，
    // 出错时就再也拿不到服务端的说明了。
    let raw = response
        .text()
        .await
        .map_err(|_| "读取 ASR 服务响应失败".to_string())?;
    if !status.is_success() {
        return Err(format!(
            "ASR 服务返回 HTTP {status}：{}",
            text_api::excerpt(&raw)
        ));
    }
    let body: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "ASR 服务响应不是有效 JSON".to_string())?;
    // 通过判定刻意保持宽松：空文字也算连接成功——上游对合法但无语音的音频
    // 就是返回 ""，收紧成「text 非空」会造成确定性假失败。
    if body.get("text").and_then(|value| value.as_str()).is_none()
        && body
            .pointer("/choices/0/message/content")
            .and_then(|value| value.as_str())
            .is_none()
    {
        return Err("ASR 服务响应缺少 text 字段".into());
    }
    Ok(())
}

#[tauri::command]
async fn transcribe_audio(request: TranscribeRequest) -> Result<TranscribeResponse, String> {
    let audio = STANDARD
        .decode(request.audio_base64)
        .map_err(|error| format!("录音数据无效：{error}"))?;
    transcribe_bytes(
        audio,
        request.filename,
        "audio/wav",
        request.endpoint,
        request.model,
    )
    .await
}

pub(crate) async fn transcribe_bytes(
    audio: Vec<u8>,
    filename: String,
    mime: &str,
    endpoint: String,
    model: String,
) -> Result<TranscribeResponse, String> {
    transcribe_bytes_with_cancel(audio, filename, mime, endpoint, model, None).await
}

async fn cancellable_request<T, F>(
    future: F,
    cancelled: Option<&Arc<AtomicBool>>,
    context: &str,
) -> Result<T, String>
where
    F: Future<Output = Result<T, reqwest::Error>>,
{
    let result = if let Some(flag) = cancelled {
        tokio::select! {
            value = future => value,
            _ = async {
                while !flag.load(Ordering::Relaxed) { tokio::time::sleep(Duration::from_millis(40)).await; }
            } => return Err("录音已取消".into()),
        }
    } else {
        future.await
    };
    result.map_err(|error| format!("{context}：{error}"))
}

pub(crate) async fn transcribe_bytes_with_cancel(
    audio: Vec<u8>,
    filename: String,
    mime: &str,
    endpoint: String,
    model: String,
    cancelled: Option<Arc<AtomicBool>>,
) -> Result<TranscribeResponse, String> {
    let started = Instant::now();
    // Windows 采集线程和浏览器预览都交付真实的 PCM16 WAV。
    // 文件名、MIME 与字节格式必须一致。
    let part = reqwest::multipart::Part::bytes(audio)
        .file_name(filename)
        .mime_str(mime)
        .map_err(|error| format!("录音格式无效：{error}"))?;
    let form = reqwest::multipart::Form::new()
        .text("model", model)
        .part("file", part);

    let response = cancellable_request(
        text_api::client()
            .post(api_url(&endpoint, "audio/transcriptions"))
            .bearer_auth(api_key()?)
            .multipart(form)
            .timeout(Duration::from_secs(120))
            .send(),
        cancelled.as_ref(),
        "语音识别请求失败",
    )
    .await?;

    let status = response.status();
    // 先读 body 再判状态：请求成功时它就是识别结果，失败时它是服务端唯一
    // 留下的线索——只回一句「HTTP 500」用户查不出任何东西。
    let body = cancellable_request(response.text(), cancelled.as_ref(), "读取识别结果失败").await?;
    if !status.is_success() {
        return Err(format!(
            "ASR 服务返回 HTTP {status}：{}",
            text_api::excerpt(&body)
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
    skills::write_atomic(&settings_path(&app)?, &data)
        .map_err(|error| format!("保存设置失败：{error}"))
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
    let session_id = session_id.unwrap_or_default();
    if !session_id.is_empty() {
        let mut sessions = paste_sessions().lock().map_err(|error| error.to_string())?;
        sessions.active.insert(session_id.clone());
        sessions.cancelled.remove(&session_id);
    }
    tauri::async_runtime::spawn_blocking(move || {
        correction_monitor::stop_learning_monitor();
        #[cfg(windows)]
        let monitor = if learn == Some(true) && correction_monitor::is_enabled() {
            correction_monitor::prepare(app, text.clone(), session_id.clone())
        } else {
            None
        };
        #[cfg(not(windows))]
        let _ = (app, learn);
        // 粘贴目标是启动口述时的前台窗口；先记下来，paste_to_foreground 里恢复用。
        #[cfg(windows)]
        let captured_foreground = paste_focus_note();
        // cfg 只能挂在 let 语句上，不能挂在调用参数上（表达式属性未稳定）。
        #[cfg(windows)]
        let result = paste_to_foreground(text, &session_id, captured_foreground);
        #[cfg(not(windows))]
        let result = paste_to_foreground(text, &session_id);
        #[cfg(windows)]
        paste_focus_restore(captured_foreground, "end");
        #[cfg(windows)]
        if let Some(monitor) = monitor {
            let _ = monitor.send(result.is_ok());
        }
        if !session_id.is_empty() {
            if let Ok(mut sessions) = paste_sessions().lock() {
                sessions.active.remove(&session_id);
                sessions.cancelled.remove(&session_id);
            }
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_paste(session_id: String) -> Result<(), String> {
    if session_id.is_empty() {
        return Ok(());
    }
    let mut sessions = paste_sessions().lock().map_err(|error| error.to_string())?;
    if sessions.active.contains(&session_id) {
        sessions.cancelled.insert(session_id);
    }
    Ok(())
}

fn paste_was_cancelled(session_id: &str) -> bool {
    if session_id.is_empty() {
        return false;
    }
    paste_sessions()
        .lock()
        .map(|sessions| sessions.cancelled.contains(session_id))
        .unwrap_or(true)
}

fn paste_to_foreground(
    text: String,
    session_id: &str,
    #[cfg(windows)] captured_foreground: Option<isize>,
) -> Result<(), String> {
    if paste_was_cancelled(session_id) {
        return Err("输入已取消".into());
    }
    let mut clipboard =
        arboard::Clipboard::new().map_err(|error| format!("无法打开剪贴板：{error}"))?;
    let previous = clipboard.get_text().ok();
    clipboard
        .set_text(text.clone())
        .map_err(|error| format!("复制失败：{error}"))?;
    thread::sleep(Duration::from_millis(70));
    if paste_was_cancelled(session_id) {
        if clipboard.get_text().ok().as_deref() == Some(text.as_str()) {
            if let Some(previous) = previous {
                let _ = clipboard.set_text(previous);
            }
        }
        return Err("输入已取消".into());
    }
    // Ctrl+V 打的是前台窗口。如果这时前台已经是自己（或别的不是用户目标的应用），
    // 键就打错了地方——先确认前台还是启动口述时的那个应用，被挪走就还回去。
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        let foreground = foreground_window();
        let mut pid = 0u32;
        let mut app = String::from("(空)");
        unsafe {
            if !foreground.is_null() {
                GetWindowThreadProcessId(foreground, &mut pid);
                if pid != 0 {
                    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                    if !process.is_null() {
                        let mut path_buf = vec![0u16; 1024];
                        let mut path_len = path_buf.len() as u32;
                        if QueryFullProcessImageNameW(
                            process,
                            0,
                            path_buf.as_mut_ptr(),
                            &mut path_len,
                        ) != 0
                        {
                            let path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
                            let file = path.rsplit(['\\', '/']).next().unwrap_or("");
                            app = file.strip_suffix(".exe").unwrap_or(file).to_string();
                        }
                        CloseHandle(process);
                    }
                }
            }
        }
        debug_log(&format!(
            "paste_to_foreground: 前台窗口 pid={pid} app={app} hwnd={foreground:p}"
        ));
        // 前台被挪走了（比如 overlay 的 show 激活了自己、或用户点了别的窗口）：
        // 把前台还给打字的应用，否则 Ctrl+V 就打进了错误窗口。
        if pid as usize == std::process::id() as usize {
            if let Some(captured) = captured_foreground {
                debug_log(&format!(
                    "paste_to_foreground: 前台是本应用，恢复到 {:p}",
                    captured as windows_sys::Win32::Foundation::HWND
                ));
                let _ = paste_focus_force(captured);
            }
        }
    }
    let result = send_ctrl_v();
    #[cfg(windows)]
    debug_log(&format!(
        "paste_to_foreground: send_ctrl_v = {}",
        if result.is_ok() {
            "已发送"
        } else {
            "失败"
        }
    ));
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
/// 而且失败时无法区分是哪一个键的问题。回退也按失败的那个键回退它自己的默认值：
/// 只回退 dictation 会把注册成功的自定义听写键也一并注销掉。
fn register_shortcuts(app: &AppHandle, dictation: &str, ask: &str, action: &str) -> Vec<String> {
    let mut notices = Vec::new();
    let attempts = [
        ("dictation", dictation, DEFAULT_DICTATION_SHORTCUT),
        ("ask", ask, DEFAULT_ASK_SHORTCUT),
        ("action", action, DEFAULT_ACTION_SHORTCUT),
    ];
    for (key, configured, default) in attempts {
        if let Err(error) = replace_shortcut(app, key, configured) {
            notices.push(error);
            // 只回退失败的那个键，保证至少有一个可用入口，同时让前端能提示用户。
            let _ = replace_shortcut(app, key, default);
        }
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
            if let Ok(mut context) = app.state::<FloatingContextState>().0.lock() {
                context.overlay_state = state.clone();
            }
            window.hide().map_err(|error| error.to_string())?;
        } else {
            #[cfg(target_os = "windows")]
            let foreground_before = foreground_window();
            let new_session = {
                let context = app.state::<FloatingContextState>();
                let mut context = context.0.lock().map_err(|e| e.to_string())?;
                let fresh = context.overlay_state.is_empty()
                    || context.overlay_state == "idle"
                    || (state == "recording" && context.overlay_state != "recording");
                context.overlay_state = state.clone();
                fresh
            };
            if let Some(monitor) = floating_monitor(&app, &window, new_session) {
                place_floating(&window, &monitor, floating::Surface::Hud)?;
            }
            window.show().map_err(|error| error.to_string())?;
            #[cfg(target_os = "windows")]
            restore_foreground(foreground_before, "set_overlay_state");
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
        .manage(FloatingContextState::default())
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
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    "main" => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    "answer" => {
                        // Alt+F4 must dismiss the reusable card, not destroy its WebView.
                        api.prevent_close();
                        let _ = window.emit("answer-window-close", ());
                        let _ = hide_answer_card(window.app_handle().clone(), None);
                    }
                    _ => {}
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let saved = load_settings(handle.clone()).unwrap_or(serde_json::json!({}));
            if saved.get("launchAtLogin").and_then(|value| value.as_bool()) == Some(true) {
                #[cfg(windows)]
                let _ = startup::apply(true);
            }
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

            if let Some(main) = app.get_webview_window("main") {
                main.set_zoom(1.0)?;
                if let Some(monitor) = main.current_monitor()?.or(main.primary_monitor()?) {
                    place_floating(&main, &monitor, floating::Surface::Main)?;
                }
            }

            if let Some(overlay) = app.get_webview_window("overlay") {
                overlay.set_focusable(false)?;
                overlay.set_zoom(1.0)?;
            }

            if let Some(answer) = app.get_webview_window("answer") {
                answer.set_zoom(1.0)?;
            }

            let record = MenuItemBuilder::with_id("record", "开始 / 结束语音输入").build(app)?;
            let ask_item = MenuItemBuilder::with_id("ask", "随便问").build(app)?;
            let action_item = MenuItemBuilder::with_id("action", "第三个快捷操作").build(app)?;
            let settings = MenuItemBuilder::with_id("settings", "打开设置").build(app)?;
            let cancel = MenuItemBuilder::with_id("cancel", "取消当前录音 / 处理").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出 typefree").build(app)?;
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
                .tooltip("typefree")
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
            if let Ok(icon) = app_icon() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;
            // 三个窗口是在 setup 回调之前由 tauri 按 tauri.conf.json 建好的，
            // 那时挂的仍是上面那份 16px 图标，得在这里覆盖掉。
            if let Ok(icon) = app_icon() {
                for (_, window) in app.webview_windows() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::list_audio_devices,
            audio::list_recoverable_audio,
            audio::start_audio_session,
            audio::stop_audio_session,
            audio::cancel_audio_session,
            audio::release_native_audio,
            audio::retain_native_audio,
            audio::cleanup_history_audio,
            history::load_history,
            history::save_history,
            history::export_history,
            audio::transcribe_native_audio,
            startup::get_launch_at_login,
            startup::set_launch_at_login,
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
            cancel_paste,
            set_shortcut,
            set_shortcut_capture_active,
            set_overlay_state,
            text_api::save_text_api_key,
            text_api::test_text_connection,
            text_api::process_text,
            text_api::stream_answer,
            text_api::cancel_text_request,
            skills::load_custom_skills,
            skills::save_custom_skills,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run typefree");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 这条断言守着两件事：图标别退化成 16×16（模糊的根因），
    /// 以及本机 DLP 加密 .png 之后，内嵌的 .ico 仍是可解码的真字节。
    #[test]
    fn app_icon_decodes_to_the_largest_frame() {
        let icon = app_icon().expect("内嵌的 icons/ink-v2/icon.ico 应能解码");
        assert_eq!((icon.width(), icon.height()), (256, 256));
        assert_eq!(icon.rgba().len(), 256 * 256 * 4);
    }

    /// 探针必须是「有内容但短」的音频：形状对得上（1 秒 16 kHz 单声道 PCM16），
    /// 而且不是整段数字静音——那正是此前稳定打出 500 的输入。
    #[test]
    fn probe_wav_is_a_real_tone_not_digital_silence() {
        let bytes = probe_wav().expect("探针 WAV 应能合成");
        assert_eq!(bytes.len(), 44 + PROBE_SAMPLES * 2);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[22..24], &1u16.to_le_bytes()); // 单声道
        assert_eq!(&bytes[24..28], &PROBE_RATE.to_le_bytes());
        assert_eq!(&bytes[34..36], &16u16.to_le_bytes()); // 位深
        assert!(
            bytes[44..].iter().any(|byte| *byte != 0),
            "探针不能是数字静音"
        );

        let samples: Vec<f32> = bytes[44..]
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / i16::MAX as f32)
            .collect();
        assert!(!audio::is_silent(&samples), "探针要能通过本地静音判定");
        let peak = samples.iter().fold(0.0f32, |acc, v| acc.max(v.abs()));
        assert!(
            peak > 0.09 && peak < 0.11,
            "峰值应贴近 PROBE_AMPLITUDE，实测 {peak}"
        );
    }
}
