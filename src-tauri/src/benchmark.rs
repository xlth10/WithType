//! Opt-in JSONL adapter. Calls the product ASR/text clients and never emits credentials.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

fn safe_error(message: &str) -> String {
    for marker in [
        "HTTP 400", "HTTP 401", "HTTP 403", "HTTP 404", "HTTP 415", "HTTP 422", "HTTP 429",
        "HTTP 500", "HTTP 502", "HTTP 503", "HTTP 504",
    ] {
        if message.contains(marker) {
            return marker.into();
        }
    }
    for (needle, safe) in [
        ("凭据", "系统凭据库不可用"),
        ("密钥", "模型凭据不可用"),
        ("API Key", "模型凭据不可用"),
        ("超时", "服务请求超时"),
        ("权限", "尚未取得系统语音识别权限"),
        ("授权", "尚未取得系统语音识别授权"),
        ("无法连接", "无法连接服务"),
        ("未完整", "文字模型未完整生成"),
        ("为空", "服务返回文本为空"),
        ("WAV", "音频必须是16kHz单声道PCM16 WAV"),
        ("不支持", "当前平台或语言不支持此识别方式"),
    ] {
        if message.contains(needle) {
            return safe.into();
        }
    }
    "benchmark调用失败；原始错误正文已省略以避免泄露凭据".into()
}
async fn dispatch(command: &str, mut args: Value) -> Result<Value, String> {
    match command {
        "health" => {
            let locale = args
                .get("locale")
                .and_then(Value::as_str)
                .unwrap_or("zh-CN");
            let status = crate::apple_speech::status(locale.into(), false).await?;
            Ok(
                json!({"transport":"product-native-client","serviceCallsAreReal":true,
                "platform":std::env::consts::OS,"nativeClientValidated":true,"appleSpeech":status,
                "credentialPolicy":"existing OS credential store; never emitted; read only on service call"}),
            )
        }
        "transcribe_audio" => {
            if args.get("request").is_some() {
                args = args["request"].take();
            }
            if let Some(path) = args.get("audioPath").and_then(Value::as_str) {
                let bytes = std::fs::read(path).map_err(|_| "无法读取benchmark音频".to_string())?;
                args["audioBase64"] = Value::String(STANDARD.encode(bytes));
            }
            let request = serde_json::from_value(args)
                .map_err(|_| "ASR benchmark请求格式错误".to_string())?;
            serde_json::to_value(crate::transcribe_audio(request).await?)
                .map_err(|_| "ASR结果序列化失败".into())
        }
        "process_text" => {
            if args.get("request").is_some() {
                args = args["request"].take();
            }
            let request = serde_json::from_value(args)
                .map_err(|_| "文字benchmark请求格式错误".to_string())?;
            serde_json::to_value(crate::text_api::process_text(request).await?)
                .map_err(|_| "文字结果序列化失败".into())
        }
        "cancel_text_request" => {
            if let Some(id) = args.get("requestId").and_then(Value::as_str) {
                crate::text_api::cancel_text_request(id.into());
            }
            Ok(json!({}))
        }
        _ => Err("benchmark不支持此命令".into()),
    }
}
pub fn run() -> Result<(), String> {
    let input = io::stdin();
    for line in input.lock().lines() {
        let line = line.map_err(|_| "无法读取benchmark输入".to_string())?;
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                println!("{}", json!({"id":null,"ok":false,"error":"无效JSONL"}));
                continue;
            }
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let command = request.get("command").and_then(Value::as_str).unwrap_or("");
        let result = tauri::async_runtime::block_on(dispatch(
            command,
            request.get("args").cloned().unwrap_or(json!({})),
        ));
        let response = match result {
            Ok(value) => json!({"id":id,"ok":true,"result":value}),
            Err(error) => json!({"id":id,"ok":false,"error":safe_error(&error)}),
        };
        println!("{response}");
        io::stdout()
            .flush()
            .map_err(|_| "无法写入benchmark结果".to_string())?;
    }
    Ok(())
}
