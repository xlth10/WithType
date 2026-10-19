//! Apple Speech runs in the app process, always requiring device-only ASR.
//! The HTTP ASR provider remains independent of this module.

use serde::{Deserialize, Serialize};
use std::sync::{atomic::AtomicBool, Arc};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleSpeechStatus {
    pub platform_supported: bool,
    pub authorization: String,
    pub available: bool,
    pub supports_on_device_recognition: bool,
    pub locale: String,
    pub supported_locales: Vec<String>,
}

fn normalize_locale(locale: String) -> Result<String, String> {
    let locale = locale.trim().replace('_', "-");
    if locale.is_empty() {
        return Ok("zh-CN".into());
    }
    if locale.len() > 64
        || !locale
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-')
    {
        return Err("Apple 语音识别语言无效，请选择支持的语言".into());
    }
    Ok(locale)
}

pub async fn status(
    locale: String,
    request_authorization: bool,
) -> Result<AppleSpeechStatus, String> {
    let locale = normalize_locale(locale)?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || native::status(&locale, request_authorization))
            .await
            .map_err(|error| format!("读取 Apple 语音识别状态失败：{error}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = request_authorization;
        Ok(AppleSpeechStatus {
            platform_supported: false,
            authorization: "notDetermined".into(),
            available: false,
            supports_on_device_recognition: false,
            locale,
            supported_locales: Vec::new(),
        })
    }
}

pub async fn transcribe(
    audio: Vec<u8>,
    locale: String,
    cancelled: Option<Arc<AtomicBool>>,
) -> Result<crate::TranscribeResponse, String> {
    let locale = normalize_locale(locale)?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || native::transcribe(audio, locale, cancelled))
            .await
            .map_err(|error| format!("Apple 语音识别任务失败：{error}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (audio, locale, cancelled);
        Err("Apple 设备端语音识别仅支持 macOS，请切换到兼容服务".into())
    }
}

const RATE: usize = 16_000;
const MAX_SEGMENT_SAMPLES: usize = RATE * 50;

/// Parse RIFF chunks rather than assuming a 44-byte header: history/retry WAVs
/// may contain metadata or an extended fmt chunk. Never misinterpret other PCM
/// layouts as 16 kHz mono, which would change playback speed or lose channels.
fn pcm_data(wav: &[u8]) -> Result<&[u8], String> {
    let invalid = || "Apple 语音识别需要 16 kHz 单声道 PCM16 WAV 录音".to_string();
    if wav.len() < 12 || &wav[..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err(invalid());
    }
    let riff_end = u32::from_le_bytes(wav[4..8].try_into().unwrap()) as usize;
    let riff_end = riff_end
        .checked_add(8)
        .filter(|end| *end <= wav.len())
        .ok_or_else(invalid)?;
    let mut offset = 12usize;
    let mut format_ok = false;
    let mut data = None;
    while offset.checked_add(8).is_some_and(|end| end <= riff_end) {
        let size = u32::from_le_bytes(wav[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let end = start
            .checked_add(size)
            .filter(|end| *end <= riff_end)
            .ok_or_else(invalid)?;
        match &wav[offset..offset + 4] {
            b"fmt " => {
                if size < 16 {
                    return Err(invalid());
                }
                let fmt = &wav[start..end];
                format_ok = u16::from_le_bytes(fmt[0..2].try_into().unwrap()) == 1
                    && u16::from_le_bytes(fmt[2..4].try_into().unwrap()) == 1
                    && u32::from_le_bytes(fmt[4..8].try_into().unwrap()) == RATE as u32
                    && u32::from_le_bytes(fmt[8..12].try_into().unwrap()) == (RATE * 2) as u32
                    && u16::from_le_bytes(fmt[12..14].try_into().unwrap()) == 2
                    && u16::from_le_bytes(fmt[14..16].try_into().unwrap()) == 16;
            }
            b"data" if data.is_none() => data = Some(&wav[start..end]),
            _ => {}
        }
        offset = end.checked_add(size & 1).ok_or_else(invalid)?;
    }
    let data = data
        .filter(|data| !data.is_empty() && data.len() % 2 == 0)
        .ok_or_else(invalid)?;
    if !format_ok {
        return Err(invalid());
    }
    Ok(data)
}

fn wav_for_pcm(pcm: &[u8]) -> Vec<u8> {
    let len = pcm.len() as u32;
    let mut wav = Vec::with_capacity(pcm.len() + 44);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(len + 36).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&(RATE as u32).to_le_bytes());
    wav.extend_from_slice(&((RATE * 2) as u32).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&len.to_le_bytes());
    wav.extend_from_slice(pcm);
    wav
}

/// Keep each SFSpeechRecognizer task below its short-dictation duration limit.
/// Prefer a quiet 120 ms window within the final five seconds; continuous
/// speech uses a hard 50 s boundary. No overlap means no duplicated words.
fn split_wav(wav: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let pcm = pcm_data(wav)?;
    let samples = pcm.len() / 2;
    let mut start = 0usize;
    let mut segments = Vec::new();
    while start < samples {
        let mut end = (start + MAX_SEGMENT_SAMPLES).min(samples);
        if end < samples {
            let window = RATE * 12 / 100;
            let search_start = end - RATE * 5;
            let mut quietest = u64::MAX;
            for position in (search_start..=end - window).step_by(RATE / 10) {
                let energy: u64 = pcm[position * 2..(position + window) * 2]
                    .chunks_exact(2)
                    .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]).unsigned_abs() as u64)
                    .sum();
                if energy <= quietest {
                    quietest = energy;
                    // Only move off the hard boundary when a quiet window was
                    // actually found, not merely the least loud spoken word.
                    if energy / window as u64 <= 300 {
                        end = position + window / 2;
                    }
                }
            }
        }
        segments.push(wav_for_pcm(&pcm[start * 2..end * 2]));
        start = end;
    }
    Ok(segments)
}

fn append_transcript(output: &mut String, next: &str) {
    let next = next.trim();
    if next.is_empty() {
        return;
    }
    let needs_space = output.chars().last().is_some_and(|last| {
        last.is_ascii_alphanumeric()
            || matches!(last, '.' | ',' | '!' | '?' | ';' | ':' | ')' | ']')
    }) && next
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_alphanumeric());
    if needs_space {
        output.push(' ');
    }
    output.push_str(next);
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    extern "C" {
        fn withtype_apple_speech_status(
            locale: *const c_char,
            request_authorization: bool,
        ) -> *mut c_char;
        fn withtype_apple_speech_start(path: *const c_char, locale: *const c_char) -> *mut c_void;
        fn withtype_apple_speech_poll(handle: *mut c_void) -> *mut c_char;
        fn withtype_apple_speech_cancel(handle: *mut c_void);
        fn withtype_apple_speech_release(handle: *mut c_void);
        fn withtype_apple_speech_free(value: *mut c_char);
    }

    fn json_result(pointer: *mut c_char) -> Result<serde_json::Value, String> {
        if pointer.is_null() {
            return Err("Apple 语音识别未返回结果".into());
        }
        let text = unsafe { CStr::from_ptr(pointer).to_string_lossy().into_owned() };
        unsafe {
            withtype_apple_speech_free(pointer);
        }
        let json: serde_json::Value =
            serde_json::from_str(&text).map_err(|_| "Apple 语音识别返回了无效结果".to_string())?;
        if let Some(error) = json.get("error").and_then(|value| value.as_str()) {
            return Err(error.into());
        }
        Ok(json)
    }

    pub(super) fn status(
        locale: &str,
        request_authorization: bool,
    ) -> Result<AppleSpeechStatus, String> {
        let locale = CString::new(locale).map_err(|_| "Apple 语音识别语言无效".to_string())?;
        let value = json_result(unsafe {
            withtype_apple_speech_status(locale.as_ptr(), request_authorization)
        })?;
        serde_json::from_value(value).map_err(|_| "Apple 语音识别状态格式无效".into())
    }

    struct RecordingFile(PathBuf);
    impl RecordingFile {
        fn create(bytes: &[u8]) -> Result<Self, String> {
            static SERIAL: AtomicU64 = AtomicU64::new(0);
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            for _ in 0..8 {
                let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
                let path = std::env::temp_dir().join(format!(
                    "withtype-apple-asr-{}-{stamp}-{serial}.wav",
                    std::process::id()
                ));
                match OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(&path)
                {
                    Ok(mut file) => {
                        let recording = Self(path);
                        file.write_all(bytes)
                            .map_err(|error| format!("写入 Apple 识别临时录音失败：{error}"))?;
                        file.flush()
                            .map_err(|error| format!("写入 Apple 识别临时录音失败：{error}"))?;
                        return Ok(recording);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(format!("创建 Apple 识别临时录音失败：{error}")),
                }
            }
            Err("创建 Apple 识别临时录音失败，请重试".into())
        }
    }
    impl Drop for RecordingFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    struct Task(*mut c_void);
    impl Drop for Task {
        fn drop(&mut self) {
            unsafe {
                withtype_apple_speech_cancel(self.0);
                withtype_apple_speech_release(self.0);
            }
        }
    }

    fn check_cancelled(cancelled: &Option<Arc<AtomicBool>>) -> Result<(), String> {
        if cancelled
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::Relaxed))
        {
            Err("录音已取消".into())
        } else {
            Ok(())
        }
    }

    pub(super) fn transcribe(
        audio: Vec<u8>,
        locale: String,
        cancelled: Option<Arc<AtomicBool>>,
    ) -> Result<crate::TranscribeResponse, String> {
        let started = Instant::now();
        check_cancelled(&cancelled)?;
        let segments = split_wav(&audio)?;
        // Authorization belongs to an explicit settings check or recording
        // preflight. A history retry/background task must never open TCC after
        // the user has cancelled it, nor wait for a permission panel to close.
        let capability = status(&locale, false)?;
        check_cancelled(&cancelled)?;
        match capability.authorization.as_str() {
            "authorized" => {}
            "denied" => return Err(
                "Apple 语音识别权限已被拒绝，请在系统设置 → 隐私与安全性 → 语音识别中允许 WithType"
                    .into(),
            ),
            "restricted" => return Err("此设备的 Apple 语音识别受到系统限制".into()),
            _ => return Err("尚未获得 Apple 语音识别权限，请先到语音服务设置点击「检查 Apple 语音识别」完成授权后重试".into()),
        }
        if !capability.supported_locales.contains(&locale) {
            return Err(format!("Apple 语音识别不支持语言 {locale}"));
        }
        if !capability.supports_on_device_recognition {
            return Err("当前语言的 Apple 设备端识别不可用，请在系统设置的听写中添加该语言并完成资源下载后重试；本次不会改用联网识别".into());
        }
        if !capability.available {
            return Err("Apple 语音识别当前不可用，请稍后重试".into());
        }
        let locale = CString::new(locale).map_err(|_| "Apple 语音识别语言无效".to_string())?;
        let mut text = String::new();
        for segment in segments {
            check_cancelled(&cancelled)?;
            let recording = RecordingFile::create(&segment)?;
            let path = CString::new(recording.0.to_string_lossy().as_bytes())
                .map_err(|_| "Apple 识别临时录音路径无效".to_string())?;
            let pointer = unsafe { withtype_apple_speech_start(path.as_ptr(), locale.as_ptr()) };
            if pointer.is_null() {
                return Err("无法启动 Apple 语音识别".into());
            }
            // Declare after the file so task cancellation happens before unlink.
            let task = Task(pointer);
            let segment_started = Instant::now();
            loop {
                check_cancelled(&cancelled)?;
                let result = unsafe { withtype_apple_speech_poll(task.0) };
                if !result.is_null() {
                    let result = json_result(result)?;
                    let next = result
                        .get("text")
                        .and_then(|value| value.as_str())
                        .ok_or_else(|| "Apple 语音识别结果缺少文字".to_string())?;
                    append_transcript(&mut text, next);
                    break;
                }
                if segment_started.elapsed() > Duration::from_secs(120) {
                    return Err("Apple 设备端识别超时，请检查系统听写语言资源后重试".into());
                }
                std::thread::sleep(Duration::from_millis(40));
            }
        }
        check_cancelled(&cancelled)?;
        Ok(crate::TranscribeResponse {
            text,
            duration_ms: started.elapsed().as_millis(),
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        #[test]
        fn temporary_recording_is_private_and_removed_on_drop() {
            let recording = RecordingFile::create(b"test recording").unwrap();
            let path = recording.0.clone();
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(std::fs::read(&path).unwrap(), b"test recording");
            drop(recording);
            assert!(!path.exists());
        }

        #[test]
        fn pre_cancelled_transcription_never_calls_speech_or_requests_permission() {
            let cancelled = Arc::new(AtomicBool::new(true));
            let result = transcribe(Vec::new(), "zh-CN".into(), Some(cancelled));
            assert_eq!(result.unwrap_err(), "录音已取消");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_long_recording_without_losing_or_repeating_samples() {
        let pcm: Vec<u8> = (0..RATE * 123)
            .flat_map(|i| ((i % 32_000) as i16).to_le_bytes())
            .collect();
        let wav = wav_for_pcm(&pcm);
        let parts = split_wav(&wav).unwrap();
        assert!(parts.len() >= 3);
        let reconstructed: Vec<u8> = parts
            .iter()
            .flat_map(|part| pcm_data(part).unwrap().iter().copied())
            .collect();
        assert_eq!(reconstructed, pcm);
        assert!(parts
            .iter()
            .all(|part| pcm_data(part).unwrap().len() <= MAX_SEGMENT_SAMPLES * 2));
    }

    #[test]
    fn prefers_silence_near_the_segment_boundary() {
        let mut pcm = vec![0x2fu8; RATE * 61 * 2];
        pcm[RATE * 47 * 2..RATE * 48 * 2].fill(0);
        let parts = split_wav(&wav_for_pcm(&pcm)).unwrap();
        let cut = pcm_data(&parts[0]).unwrap().len() / 2;
        assert!((RATE * 47..RATE * 48).contains(&cut));
    }

    #[test]
    fn rejects_truncated_and_wrong_format_audio() {
        let mut wav = wav_for_pcm(&[0; 64]);
        assert!(pcm_data(&wav[..wav.len() - 1]).is_err());
        wav[22..24].copy_from_slice(&2u16.to_le_bytes());
        assert!(pcm_data(&wav).is_err());
    }

    #[test]
    fn joins_chinese_and_latin_boundaries_without_duplicate_content() {
        let mut output = String::new();
        for part in ["你好", "世界", "WithType", "works", "。"] {
            append_transcript(&mut output, part);
        }
        assert_eq!(output, "你好世界WithType works。");
        let mut english = "Hello.".to_string();
        append_transcript(&mut english, "Next sentence.");
        assert_eq!(english, "Hello. Next sentence.");
    }

    #[test]
    fn normalizes_default_and_underscore_locale() {
        assert_eq!(normalize_locale(String::new()).unwrap(), "zh-CN");
        assert_eq!(normalize_locale("zh_CN".into()).unwrap(), "zh-CN");
        assert!(normalize_locale("bad\0locale".into()).is_err());
    }

    #[test]
    fn native_status_json_requires_boolean_fields() {
        // Status shape captured from the Objective-C helper. The platform and
        // language capability fields are JSON booleans, never NSNumber ints.
        let payload = serde_json::json!({
            "locale": "zh-CN",
            "supportsOnDeviceRecognition": false,
            "authorization": "denied",
            "supportedLocales": ["en-US", "zh-CN"],
            "platformSupported": true,
            "available": true,
        });
        let decoded: AppleSpeechStatus = serde_json::from_value(payload.clone()).unwrap();
        assert!(decoded.available);
        assert!(!decoded.supports_on_device_recognition);
        for field in [
            "available",
            "supportsOnDeviceRecognition",
            "platformSupported",
        ] {
            let mut invalid = payload.clone();
            invalid[field] = serde_json::json!(1);
            assert!(serde_json::from_value::<AppleSpeechStatus>(invalid).is_err());
        }
    }
}
