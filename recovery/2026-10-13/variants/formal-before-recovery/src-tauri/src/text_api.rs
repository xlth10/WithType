// 内网文字模型客户端：OpenAI 兼容的 Chat Completions。
//
// 两处安全约束，改这个文件时必须保持：
// 1. 前端与配置文件都不保存密钥。密钥只进系统凭据库，按 account 区分 ASR 与文字模型。
// 2. 任何错误消息都不回显密钥、也不回显服务端返回的完整响应体——
//    私有网关的报错里经常会带上请求头或回显请求内容。

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::SERVICE_NAME;

const TEXT_ACCOUNT_NAME: &str = "text-model-api-key";

/// Reject oversize input; segmentation belongs to the task pipeline.
const MAX_INPUT_CHARS: usize = 12000;
/// 服务端返回内容的字符上限，防止异常服务返回超大响应拖垮前端。
const MAX_OUTPUT_CHARS: usize = 60000;
/// 错误消息里允许出现的响应体片段长度。
const ERROR_EXCERPT_CHARS: usize = 200;

const DEFAULT_TIMEOUT_MS: u64 = 60_000;
// A later attempt may only have a few milliseconds left in its shared budget.
const MIN_TIMEOUT_MS: u64 = 1;
const MAX_TIMEOUT_MS: u64 = 300_000;

/// 复用同一个 Client：每次请求新建 Client 会重复建连接池和 TLS 上下文，
/// 在「按一下快捷键就要秒回」的路径上是实打实的开销。
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

#[derive(Default)]
struct TextSessions {
    active: HashMap<String, Arc<tokio::sync::Notify>>,
    cancelled: HashSet<String>,
}
static TEXT_SESSIONS: OnceLock<Mutex<TextSessions>> = OnceLock::new();
fn sessions() -> &'static Mutex<TextSessions> {
    TEXT_SESSIONS.get_or_init(|| Mutex::new(TextSessions::default()))
}

#[tauri::command]
pub fn cancel_text_request(request_id: String) {
    if let Ok(mut state) = sessions().lock() {
        state.cancelled.insert(request_id.clone());
        if let Some(notify) = state.active.get(&request_id) {
            notify.notify_one();
        }
        if state.cancelled.len() > 128 {
            state.cancelled = state.cancelled.iter().take(64).cloned().collect();
        }
    }
}

pub fn cancel_task_requests(task_id: &str) {
    cancel_text_request(task_id.to_owned());
    if let Ok(state) = sessions().lock() {
        let prefix = format!("{task_id}:");
        for (id, notify) in &state.active {
            if id.starts_with(&prefix) {
                notify.notify_one();
            }
        }
    }
}

async fn cancellable<F, T>(request_id: &str, future: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    let notify = Arc::new(tokio::sync::Notify::new());
    {
        let mut state = sessions().lock().map_err(|e| e.to_string())?;
        if state.cancelled.contains(request_id)
            || state
                .cancelled
                .contains(request_id.split(':').next().unwrap_or(request_id))
        {
            return Err("文字请求已取消".into());
        }
        state.active.insert(request_id.to_string(), notify.clone());
    }
    let result = tokio::select! {
        output = future => output,
        _ = notify.notified() => Err("文字请求已取消".into()),
    };
    if let Ok(mut state) = sessions().lock() {
        state.active.remove(request_id);
    }
    result
}

fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

fn validate_input(request: &ProcessTextRequest) -> Result<(), String> {
    if request.raw_text.chars().count() > MAX_INPUT_CHARS {
        return Err("文本超过单次处理上限，原文已保留，请分段运行".into());
    }
    if request
        .messages
        .iter()
        .map(|m| m.content.chars().count())
        .sum::<usize>()
        > 100000
    {
        return Err("文字请求上下文过长，请缩短单次输入".into());
    }
    Ok(())
}

async fn bounded_request<F>(request: &ProcessTextRequest, future: F) -> Result<String, String>
where
    F: std::future::Future<Output = Result<String, String>>,
{
    cancellable(&request.request_id, async {
        tokio::time::timeout(clamp_timeout(request.timeout_ms), future)
            .await
            .map_err(|_| "文字模型响应超时".to_string())?
    })
    .await
}

fn emit_stream(app: &AppHandle, request: &ProcessTextRequest, text: &str) {
    let event = if request.task == "ask" {
        "answer-stream"
    } else {
        "text-stream"
    };
    let _ = app.emit(
        event,
        AnswerStreamEvent {
            request_id: request
                .session_id
                .clone()
                .unwrap_or_else(|| request.request_id.clone()),
            call_id: request.request_id.clone(),
            question: if request.task == "ask" {
                request.raw_text.clone()
            } else {
                String::new()
            },
            text: text.to_string(),
        },
    );
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// 前端每次调用都会带上这三个「这次是谁的请求」字段。Rust 侧不用它们做任何路由——
/// 任务有效性由前端用 requestId 判定（见 src/dictation/pipeline.js），后端只负责发请求。
/// 保留在结构体里是为了让契约字段不被 serde 静默丢弃，将来排查时也能直接对上界面上的那一条任务。
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTextRequest {
    #[serde(default)]
    pub request_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub task: String,
    pub raw_text: String,
    #[serde(default)]
    pub skill_id: Option<String>,
    pub endpoint: String,
    pub model: String,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub auth_mode: Option<String>,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTextResponse {
    pub text: String,
    pub duration_ms: u128,
}

#[derive(Debug, Serialize, Deserialize)]
struct OutgoingMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<OutgoingMessage>,
    temperature: f32,
    stream: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AnswerStreamEvent {
    request_id: String,
    call_id: String,
    question: String,
    text: String,
}

fn text_api_key() -> Result<String, String> {
    keyring::Entry::new(SERVICE_NAME, TEXT_ACCOUNT_NAME)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?
        .get_password()
        .map_err(|_| "尚未保存文字模型 API Key".to_string())
}

/// 把用户填的地址补成完整的 chat/completions URL。
///
/// 界面提示「填到 /v1 即可」，但用户可能填成 http://host/v1/ 或 http://host，
/// 这里统一裁掉尾部斜杠和 /v1，再拼一次，避免出现 /v1/v1/chat/completions。
fn chat_endpoint(endpoint: &str) -> String {
    let mut base = endpoint.trim();
    while base.ends_with('/') {
        base = &base[..base.len() - 1];
    }
    if let Some(stripped) = base.strip_suffix("/v1") {
        base = stripped.trim_end_matches('/');
    }
    format!("{base}/v1/chat/completions")
}

/// 只从响应体里取一段安全摘要：去掉换行、截断长度。
/// 绝不整段回显，也不做任何形如 sk-xxx 的透传。
fn excerpt(body: &str) -> String {
    let flattened: String = body
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect();
    let mut text: String = flattened.trim().chars().take(ERROR_EXCERPT_CHARS).collect();
    if flattened.trim().chars().count() > ERROR_EXCERPT_CHARS {
        text.push('…');
    }
    text
}

fn clamp_timeout(value: Option<u64>) -> Duration {
    let millis = value
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    Duration::from_millis(millis)
}

fn build_chat_request(request: &ProcessTextRequest) -> ChatRequest {
    ChatRequest {
        model: request.model.trim().to_string(),
        messages: request
            .messages
            .iter()
            .map(|message| OutgoingMessage {
                role: message.role.clone(),
                content: message.content.clone(),
            })
            .collect(),
        // 整理任务要可复现，固定低温度；不在界面暴露这个参数，避免用户把它调成随机改写。
        temperature: 0.2,
        stream: false,
    }
}

/// 解析 OpenAI 兼容响应：至少支持 choices[0].message.content。
fn parse_content(body: &str) -> Result<String, String> {
    let json: serde_json::Value =
        serde_json::from_str(body).map_err(|error| format!("无法解析文字模型响应：{error}"))?;
    if json
        .pointer("/choices/0/finish_reason")
        .and_then(|r| r.as_str())
        .is_some_and(|r| r != "stop")
    {
        return Err("文字模型未完整生成成稿，请重试或缩短单次输入".into());
    }
    let content = json
        .pointer("/choices/0/message/content")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if content.is_empty() {
        return Err("文字模型没有返回内容".to_string());
    }
    if content.chars().count() > MAX_OUTPUT_CHARS {
        return Err("文字模型输出超限，原文已保留".into());
    }
    Ok(content)
}

fn is_quota_error(body: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .is_some_and(|value| {
            let code = value
                .pointer("/error/code")
                .and_then(|item| item.as_str())
                .or_else(|| value.get("code").and_then(|item| item.as_str()))
                .unwrap_or("")
                .to_ascii_lowercase();
            [
                "insufficient_quota",
                "quotaexceeded",
                "arrearage",
                "accountoverdueerror",
            ]
            .contains(&code.as_str())
        })
}

async fn post_chat(request: &ProcessTextRequest) -> Result<String, String> {
    if request.model.trim().is_empty() {
        return Err("尚未配置文字模型名称".into());
    }
    if request.endpoint.trim().is_empty() {
        return Err("尚未配置文字模型地址".into());
    }

    let mut builder = client()
        .post(chat_endpoint(&request.endpoint))
        .json(&build_chat_request(request))
        .timeout(clamp_timeout(request.timeout_ms));

    // authMode "none" 是给明确不需要认证的私有服务用的显式开关，
    // 而不是「密钥读取失败就悄悄不带认证」——那种降级会让 401 变得难以排查。
    if request.auth_mode.as_deref() != Some("none") {
        builder = builder.bearer_auth(text_api_key()?);
    }

    let response = builder.send().await.map_err(|error| {
        if error.is_timeout() {
            "文字模型响应超时".to_string()
        } else if error.is_connect() {
            "无法连接文字模型服务，请检查地址与网络".to_string()
        } else {
            format!("文字模型请求失败：{error}")
        }
    })?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取文字模型响应失败：{error}"))?;

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("文字模型认证失败（401），请检查 API Key 或认证方式".into());
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        if is_quota_error(&body) {
            return Err("文字模型额度用尽（403）".into());
        }
        return Err("文字模型拒绝访问（403），请确认账号是否有该模型权限".into());
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS && is_quota_error(&body) {
        return Err("文字模型额度用尽（429）".into());
    }
    if !status.is_success() {
        return Err(format!("文字模型返回 HTTP {status}：{}", excerpt(&body)));
    }
    parse_content(&body)
}

/// OpenAI-compatible SSE. Gate each emission by requestId in the WebView.
/// Gateways that ignore or reject stream=true are retried once as a normal response.
async fn post_chat_stream(app: &AppHandle, request: &ProcessTextRequest) -> Result<String, String> {
    if request.model.trim().is_empty() || request.endpoint.trim().is_empty() {
        return Err("尚未配置文字模型地址或名称".into());
    }
    let mut body = build_chat_request(request);
    body.stream = true;
    let mut builder = client()
        .post(chat_endpoint(&request.endpoint))
        .json(&body)
        .timeout(clamp_timeout(request.timeout_ms));
    if request.auth_mode.as_deref() != Some("none") {
        builder = builder.bearer_auth(text_api_key()?);
    }
    let mut response = builder.send().await.map_err(|error| {
        if error.is_timeout() {
            "文字模型响应超时".to_string()
        } else {
            format!("文字模型请求失败：{error}")
        }
    })?;
    if !response.status().is_success() {
        if response.status() == reqwest::StatusCode::FORBIDDEN
            || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
        {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if is_quota_error(&body) {
                return Err(format!("文字模型额度用尽（{}）", status.as_u16()));
            }
            if status == reqwest::StatusCode::FORBIDDEN {
                return Err("文字模型拒绝访问（403），请确认账号是否有该模型权限".into());
            }
            return Err("文字模型返回 HTTP 429".into());
        }
        if response.status().as_u16() == 400
            || response.status().as_u16() == 404
            || response.status().as_u16() == 422
        {
            return post_chat(request).await;
        }
        return Err(format!("文字模型返回 HTTP {}", response.status()));
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .contains("text/event-stream")
    {
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取文字模型响应失败：{e}"))?;
        let text = parse_content(&body)?;
        emit_stream(app, request, &text);
        return Ok(text);
    }
    let mut pending = Vec::new();
    let mut stream = crate::text_stream::TextStream::default();
    let mut last_emit = std::time::Instant::now() - Duration::from_secs(1);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取流式文字失败".to_string())?
    {
        pending.extend_from_slice(&chunk);
        while let Some(index) = pending.iter().position(|byte| *byte == b'\n') {
            let line = std::str::from_utf8(&pending[..index])
                .map_err(|_| "文字模型流式编码错误".to_string())?
                .trim_end_matches('\r')
                .to_string();
            pending.drain(..=index);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let done = stream.push(data.trim())?;
            if !stream.text.is_empty() && (done || last_emit.elapsed() >= Duration::from_millis(50))
            {
                emit_stream(app, request, &stream.text);
                last_emit = std::time::Instant::now();
            }
            if done {
                return Ok(stream.text.trim().to_string());
            }
        }
        if pending.len() > 1_000_000 {
            return Err("文字模型流式响应过长".into());
        }
    }
    if !pending.is_empty() {
        let line = std::str::from_utf8(&pending).map_err(|_| "文字模型流式编码错误".to_string())?;
        if let Some(data) = line.trim().strip_prefix("data:") {
            stream.push(data.trim())?;
        }
    }
    stream.validate()?;
    emit_stream(app, request, &stream.text);
    Ok(stream.text.trim().to_string())
}

#[tauri::command]
pub fn save_text_api_key(key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Ok(());
    }
    keyring::Entry::new(SERVICE_NAME, TEXT_ACCOUNT_NAME)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?
        .set_password(key.trim())
        .map_err(|error| format!("保存文字模型 API Key 失败：{error}"))
}

/// 文字服务连接测试。
///
/// 刻意不用 GET /models：那个接口在不少私有网关上被禁用或根本不实现，
/// 于是「能连上」被误报成「连不上」。这里发一段真实短文本走完整链路，
/// 返回什么内容不重要，能拿到合法的 choices[0].message.content 才算通过。
#[tauri::command]
pub async fn test_text_connection(
    endpoint: String,
    model: String,
    timeout_ms: Option<u64>,
    auth_mode: Option<String>,
) -> Result<String, String> {
    let request = ProcessTextRequest {
        request_id: "test".into(),
        session_id: None,
        task: "preview".into(),
        raw_text: "连接测试".into(),
        skill_id: None,
        endpoint,
        model,
        timeout_ms,
        auth_mode,
        messages: vec![
            ChatMessage {
                role: "system".into(),
                content: "你是连通性测试端点。只回复「ok」两个字符，不要有任何其它输出。".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "连接测试：请回复 ok".into(),
            },
        ],
    };
    let text = post_chat(&request).await?;
    Ok(excerpt(&text))
}

#[tauri::command]
pub async fn process_text(request: ProcessTextRequest) -> Result<ProcessTextResponse, String> {
    let started = std::time::Instant::now();
    // Reject oversize requests rather than silently discarding the end.
    validate_input(&request)?;
    let text = bounded_request(&request, post_chat(&request)).await?;
    Ok(ProcessTextResponse {
        text,
        duration_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn stream_answer(
    app: AppHandle,
    request: ProcessTextRequest,
) -> Result<ProcessTextResponse, String> {
    let started = std::time::Instant::now();
    if request.task != "ask" {
        return Err("流式接口仅用于问答".into());
    }
    validate_input(&request)?;
    let text = bounded_request(&request, post_chat_stream(&app, &request)).await?;
    Ok(ProcessTextResponse {
        text,
        duration_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn stream_text(
    app: AppHandle,
    request: ProcessTextRequest,
) -> Result<ProcessTextResponse, String> {
    if !matches!(
        request.task.as_str(),
        "smart" | "skill" | "translate" | "command"
    ) {
        return Err("此任务不支持流式文字预览".into());
    }
    validate_input(&request)?;
    let started = std::time::Instant::now();
    let text = bounded_request(&request, post_chat_stream(&app, &request)).await?;
    Ok(ProcessTextResponse {
        text,
        duration_ms: started.elapsed().as_millis(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_cancellation_stops_active_children_and_rejects_late_children() {
        let parent = "lifecycle-test-parent";
        let child = format!("{parent}:segment-1");
        let notify = Arc::new(tokio::sync::Notify::new());
        let other = Arc::new(tokio::sync::Notify::new());
        {
            let mut state = sessions().lock().unwrap();
            state.active.insert(child.clone(), notify.clone());
            state
                .active
                .insert("lifecycle-test-unrelated:segment-1".into(), other.clone());
        }
        cancel_task_requests(parent);
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            tokio::time::timeout(Duration::from_millis(50), notify.notified())
                .await
                .unwrap();
            assert!(
                tokio::time::timeout(Duration::from_millis(1), other.notified())
                    .await
                    .is_err()
            );
            let mut started = false;
            let result = cancellable(&format!("{parent}:segment-2"), async {
                started = true;
                Ok::<(), String>(())
            })
            .await;
            assert_eq!(result.unwrap_err(), "文字请求已取消");
            assert!(!started, "cancelled child must not start network work");
        });
        let mut state = sessions().lock().unwrap();
        state.active.remove(&child);
        state.active.remove("lifecycle-test-unrelated:segment-1");
        state.cancelled.remove(parent);
    }

    /// 测试夹具里出现的都是明显的假值，绝不使用真实内网密钥（见 README 的 Security 段）。
    const FAKE_KEY_SHAPED_TEXT: &str = "sk-this-is-not-a-real-key";

    fn request(messages: Vec<(&str, &str)>) -> ProcessTextRequest {
        ProcessTextRequest {
            request_id: "test".into(),
            session_id: None,
            task: "smart".into(),
            raw_text: "原始文本".into(),
            skill_id: None,
            endpoint: "http://text.internal/v1".into(),
            model: "internal-text-model".into(),
            timeout_ms: None,
            auth_mode: None,
            messages: messages
                .into_iter()
                .map(|(role, content)| ChatMessage {
                    role: role.into(),
                    content: content.into(),
                })
                .collect(),
        }
    }

    #[test]
    fn chat_endpoint_accepts_every_shape_users_type() {
        // 界面提示「填到 /v1」，但用户会填成各种形状；这里保证拼出来永远是
        // 唯一的 /v1/chat/completions，不会出现 /v1/v1/。
        assert_eq!(
            chat_endpoint("http://text.internal/v1"),
            "http://text.internal/v1/chat/completions"
        );
        assert_eq!(
            chat_endpoint("http://text.internal/v1/"),
            "http://text.internal/v1/chat/completions"
        );
        assert_eq!(
            chat_endpoint("http://text.internal"),
            "http://text.internal/v1/chat/completions"
        );
        assert_eq!(
            chat_endpoint("http://text.internal/"),
            "http://text.internal/v1/chat/completions"
        );
        assert_eq!(
            chat_endpoint("  http://text.internal/v1  "),
            "http://text.internal/v1/chat/completions"
        );
        assert_eq!(
            chat_endpoint("http://text.internal/v1/chat/completions"),
            "http://text.internal/v1/chat/completions/v1/chat/completions"
        );
    }

    #[test]
    fn excerpt_strips_control_characters_and_truncates() {
        // 私有网关的报错常带换行和 ANSI 控制字符，直接回显会把界面撑乱。
        assert_eq!(excerpt("  \n  服务不可用 \r\n "), "服务不可用");

        let long = "字".repeat(ERROR_EXCERPT_CHARS + 50);
        let clipped = excerpt(&long);
        assert_eq!(clipped.chars().count(), ERROR_EXCERPT_CHARS + 1);
        assert!(clipped.ends_with('…'));

        // 刚好到上限时不该多出省略号。
        let exact = "字".repeat(ERROR_EXCERPT_CHARS);
        assert_eq!(excerpt(&exact), exact);
        assert!(!excerpt(&exact).ends_with('…'));
    }

    #[test]
    fn excerpt_never_leaks_a_key_shaped_string_whole() {
        // 合约：错误消息只允许出现 200 字符以内的摘要。
        let body = format!(
            "{}{}",
            "x".repeat(ERROR_EXCERPT_CHARS + 10),
            FAKE_KEY_SHAPED_TEXT
        );
        let clipped = excerpt(&body);
        assert!(clipped.chars().count() <= ERROR_EXCERPT_CHARS + 1);
        assert!(!clipped.contains(FAKE_KEY_SHAPED_TEXT));
    }

    #[test]
    fn clamp_timeout_holds_the_configured_range() {
        assert_eq!(
            clamp_timeout(None),
            Duration::from_millis(DEFAULT_TIMEOUT_MS)
        );
        assert_eq!(clamp_timeout(Some(10)), Duration::from_millis(10));
        assert_eq!(
            clamp_timeout(Some(u64::MAX)),
            Duration::from_millis(MAX_TIMEOUT_MS)
        );
        assert_eq!(clamp_timeout(Some(45_000)), Duration::from_millis(45_000));
    }

    #[test]
    fn build_chat_request_pins_temperature_and_stream() {
        let chat = build_chat_request(&request(vec![("system", "整理"), ("user", "原文")]));
        assert_eq!(chat.model, "internal-text-model");
        assert_eq!(chat.temperature, 0.2);
        assert!(!chat.stream);
        assert_eq!(chat.messages.len(), 2);
        assert_eq!(chat.messages[0].role, "system");

        let trimmed = build_chat_request(&ProcessTextRequest {
            model: "  spaced-model  ".into(),
            ..request(vec![])
        });
        assert_eq!(trimmed.model, "spaced-model");
    }

    #[test]
    fn parse_content_reads_the_openai_shape() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"整理好的结果"}}]}"#;
        assert_eq!(parse_content(body).unwrap(), "整理好的结果");

        // 前后空白要被裁掉，否则上屏会多出空行。
        let padded = r#"{"choices":[{"message":{"content":"  结果  "}}]}"#;
        assert_eq!(parse_content(padded).unwrap(), "结果");
    }

    #[test]
    fn parse_content_rejects_empty_and_malformed_bodies() {
        assert_eq!(
            parse_content(r#"{"choices":[{"message":{"content":"   "}}]}"#).unwrap_err(),
            "文字模型没有返回内容"
        );
        assert_eq!(
            parse_content(r#"{"choices":[]}"#).unwrap_err(),
            "文字模型没有返回内容"
        );
        assert_eq!(
            parse_content(r#"{"error":{"message":"model not found"}}"#).unwrap_err(),
            "文字模型没有返回内容"
        );
        assert_eq!(
            parse_content(r#"{"choices":[{"message":{"content":42}}]}"#).unwrap_err(),
            "文字模型没有返回内容"
        );
        assert!(parse_content("<html>502 Bad Gateway</html>")
            .unwrap_err()
            .starts_with("无法解析文字模型响应："));
    }

    #[test]
    fn parse_content_caps_absurdly_long_output() {
        let body = format!(
            r#"{{"choices":[{{"message":{{"content":"{}"}}}}]}}"#,
            "字".repeat(MAX_OUTPUT_CHARS + 100)
        );
        assert!(parse_content(&body).unwrap_err().contains("超限"));
    }

    #[test]
    fn input_limits_are_rejected_without_mutating_messages() {
        let mut r = request(vec![("user", "保留原文")]);
        r.raw_text = "字".repeat(MAX_INPUT_CHARS + 1);
        assert!(validate_input(&r).unwrap_err().contains("上限"));
        assert_eq!(r.messages[0].content, "保留原文");
    }

    #[test]
    fn incomplete_nonstream_output_is_not_a_success() {
        assert!(parse_content(
            r#"{"choices":[{"message":{"content":"半篇"},"finish_reason":"length"}]}"#
        )
        .is_err());
    }

    #[tokio::test]
    async fn invocation_deadline_covers_all_work_and_releases_cancellation_state() {
        let mut r = request(vec![]);
        r.request_id = "deadline-fixture".into();
        r.timeout_ms = Some(5);
        let result = bounded_request(&r, async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            Ok("迟到结果".into())
        })
        .await;
        assert!(result.unwrap_err().contains("超时"));
        assert!(!sessions()
            .lock()
            .unwrap()
            .active
            .contains_key(&r.request_id));
        assert_eq!(
            bounded_request(&r, async { Ok("及时结果".into()) })
                .await
                .unwrap(),
            "及时结果"
        );
    }
}
