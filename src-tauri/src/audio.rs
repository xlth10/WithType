//! Windows native capture. CPAL's Windows host uses shared-mode WASAPI.
//! The WebView receives levels and session IDs, never the captured PCM.

const OUTPUT_RATE: u32 = 16_000;
const MAX_SECONDS: usize = 15 * 60;

/// Streaming, band-limited resampling. `position` and `base` carry across
/// device callbacks, so a callback boundary cannot create a click or gap.
struct Resampler {
    ratio: f64,
    cutoff: f64,
    position: f64,
    base: usize,
    input: std::collections::VecDeque<f32>,
    output: Vec<f32>,
}

impl Resampler {
    const RADIUS: isize = 24;

    fn new(source_rate: u32) -> Self {
        Self {
            ratio: source_rate as f64 / OUTPUT_RATE as f64,
            cutoff: 0.45 * (OUTPUT_RATE as f64 / source_rate as f64).min(1.0),
            position: 0.0,
            base: 0,
            input: std::collections::VecDeque::new(),
            output: Vec::new(),
        }
    }

    fn push_interleaved(&mut self, data: &[f32], channels: usize) -> Result<f32, String> {
        if channels == 0 {
            return Err("麦克风返回了无效声道数".into());
        }
        let mut energy = 0.0f64;
        let mut frames = 0usize;
        for frame in data.chunks_exact(channels) {
            let mono = frame.iter().copied().sum::<f32>() / channels as f32;
            energy += (mono as f64) * (mono as f64);
            frames += 1;
            self.input.push_back(mono);
        }
        self.produce(false);
        if self.output.len() > OUTPUT_RATE as usize * MAX_SECONDS {
            return Err("录音达到 15 分钟上限，请先结束并处理当前内容".into());
        }
        Ok(if frames == 0 {
            0.0
        } else {
            (energy / frames as f64).sqrt() as f32
        })
    }

    fn sample_at(&self, index: isize) -> f64 {
        if index < self.base as isize {
            return 0.0;
        }
        self.input
            .get(index as usize - self.base)
            .copied()
            .unwrap_or(0.0) as f64
    }

    fn produce(&mut self, flush: bool) {
        let real_end = self.base + self.input.len();
        let max_position = if flush {
            real_end as f64
        } else {
            real_end.saturating_sub(Self::RADIUS as usize) as f64
        };
        while self.position < max_position {
            let centre = self.position.floor() as isize;
            let mut value = 0.0f64;
            let mut weight = 0.0f64;
            for index in (centre - Self::RADIUS + 1)..=(centre + Self::RADIUS) {
                let distance = index as f64 - self.position;
                let phase = 2.0 * self.cutoff * distance;
                let sinc = if phase.abs() < 1e-9 {
                    1.0
                } else {
                    (std::f64::consts::PI * phase).sin() / (std::f64::consts::PI * phase)
                };
                let window =
                    0.5 + 0.5 * (std::f64::consts::PI * distance / Self::RADIUS as f64).cos();
                let tap = 2.0 * self.cutoff * sinc * window.max(0.0);
                value += self.sample_at(index) * tap;
                weight += tap;
            }
            self.output
                .push((value / weight.max(1e-9)).clamp(-1.0, 1.0) as f32);
            self.position += self.ratio;
            let retain_from = (self.position.floor() as isize - Self::RADIUS).max(0) as usize;
            while self.base < retain_from && !self.input.is_empty() {
                self.input.pop_front();
                self.base += 1;
            }
        }
    }

    fn finish(mut self) -> Vec<f32> {
        self.produce(true);
        self.output
    }
}

fn wav_bytes(samples: &[f32]) -> Result<Vec<u8>, String> {
    let data_len = samples.len().checked_mul(2).ok_or("录音过长")?;
    let data_len = u32::try_from(data_len).map_err(|_| "录音过长")?;
    let mut bytes = Vec::with_capacity(data_len as usize + 44);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(data_len + 36).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&OUTPUT_RATE.to_le_bytes());
    bytes.extend_from_slice(&(OUTPUT_RATE * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        let pcm = ((*sample).clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        bytes.extend_from_slice(&pcm.to_le_bytes());
    }
    Ok(bytes)
}

/// Choose a low-energy boundary after 3.5 seconds while preserving the last
/// 1.5 seconds. Continuous speech has no eligible boundary.
fn pause_end(samples: &[f32], committed: usize) -> Option<usize> {
    let min_end = committed + OUTPUT_RATE as usize * 7 / 2;
    let safe_end = samples.len().saturating_sub(OUTPUT_RATE as usize * 3 / 2);
    if safe_end <= min_end {
        return None;
    }
    let window = OUTPUT_RATE as usize / 25;
    let mut peak = 0.0f32;
    let mut candidates = Vec::new();
    for start in (committed..safe_end).step_by(window) {
        let end = (start + window).min(samples.len());
        let rms =
            (samples[start..end].iter().map(|v| v * v).sum::<f32>() / (end - start) as f32).sqrt();
        peak = peak.max(rms);
        if start >= min_end {
            candidates.push((start, rms));
        }
    }
    if peak < 0.008 {
        return None;
    }
    let threshold = (peak * 0.28).min(0.012);
    let target = committed + OUTPUT_RATE as usize * 6;
    candidates
        .into_iter()
        .filter(|(_, rms)| *rms < threshold)
        .min_by(|a, b| {
            let score = |(pos, rms): &(usize, f32)| {
                *rms / threshold
                    + ((*pos as isize - target as isize).unsigned_abs() as f32 / OUTPUT_RATE as f32)
                        * 0.08
            };
            score(a).total_cmp(&score(b))
        })
        .map(|(start, _)| start)
}

fn has_voice(samples: &[f32]) -> bool {
    samples.iter().any(|sample| sample.abs() > 0.012)
}

fn join_transcripts(parts: &[String]) -> String {
    let mut result = String::new();
    for part in parts {
        let piece = part.trim();
        if piece.is_empty() {
            continue;
        }
        let separated_words = result
            .chars()
            .last()
            .is_some_and(|c| c.is_ascii_alphanumeric())
            && piece
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric());
        if separated_words {
            result.push(' ');
        }
        result.push_str(piece);
    }
    result
}

#[cfg(windows)]
mod platform {
    use super::{has_voice, join_transcripts, pause_end, wav_bytes, Resampler, OUTPUT_RATE};
    use cpal::{
        traits::{DeviceTrait, HostTrait, StreamTrait},
        FromSample, Sample, SampleFormat, SizedSample,
    };
    use serde::Serialize;
    use std::{
        collections::{HashMap, HashSet},
        fs,
        io::Write,
        path::PathBuf,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc, Mutex, OnceLock,
        },
        thread,
        time::{Duration, Instant},
    };
    use tauri::{AppHandle, Emitter, Manager};

    const SPOOL_INTERVAL: usize = OUTPUT_RATE as usize * 2;
    const SPOOL_MAGIC: &[u8; 4] = b"TFA1";

    fn spool_root(app: &AppHandle) -> Result<PathBuf, String> {
        let path = app
            .path()
            .app_config_dir()
            .map_err(|e| e.to_string())?
            .join("recoverable-audio");
        fs::create_dir_all(&path).map_err(|e| format!("无法创建录音暂存目录：{e}"))?;
        Ok(path)
    }

    fn session_path(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
        if session_id.is_empty()
            || session_id.len() > 80
            || !session_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("录音会话 ID 无效".into());
        }
        Ok(spool_root(app)?.join(session_id))
    }

    fn write_chunk(directory: &PathBuf, sequence: usize, samples: &[f32]) -> Result<(), String> {
        if samples.is_empty() {
            return Ok(());
        }
        let mut plain = Vec::with_capacity(samples.len() * 2);
        for sample in samples {
            let pcm = ((*sample).clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
            plain.extend_from_slice(&pcm.to_le_bytes());
        }
        let mut encrypted = SPOOL_MAGIC.to_vec();
        encrypted.extend_from_slice(&crate::history::protect_data(&plain)?);
        let target = directory.join(format!("{sequence:06}.enc"));
        let temp = directory.join(format!("{sequence:06}.new"));
        let mut file = fs::File::create(&temp).map_err(|e| format!("录音暂存失败：{e}"))?;
        file.write_all(&encrypted)
            .map_err(|e| format!("录音暂存失败：{e}"))?;
        file.sync_all().map_err(|e| format!("录音暂存失败：{e}"))?;
        drop(file);
        fs::rename(&temp, &target).map_err(|e| format!("录音暂存失败：{e}"))
    }

    fn read_session(app: &AppHandle, session_id: &str) -> Result<Vec<f32>, String> {
        let directory = session_path(app, session_id)?;
        let mut files: Vec<_> = fs::read_dir(directory)
            .map_err(|e| format!("读取录音暂存失败：{e}"))?
            .map(|item| item.map(|entry| entry.path()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取录音暂存失败：{e}"))?
            .into_iter()
            .filter(|path| path.extension().is_some_and(|ext| ext == "enc"))
            .collect();
        files.sort();
        if files.is_empty() {
            return Err("没有可恢复的录音数据".into());
        }
        let mut samples = Vec::new();
        for (index, path) in files.iter().enumerate() {
            if path.file_stem().and_then(|name| name.to_str())
                != Some(format!("{index:06}").as_str())
            {
                return Err("录音暂存段不连续，已保留文件供恢复".into());
            }
            let data = fs::read(path).map_err(|e| format!("读取录音暂存失败：{e}"))?;
            if !data.starts_with(SPOOL_MAGIC) {
                return Err("录音暂存格式无效".into());
            }
            let plain = crate::history::unprotect_data(&data[SPOOL_MAGIC.len()..])?;
            if plain.len() % 2 != 0 {
                return Err("录音暂存数据损坏".into());
            }
            if samples.len() + plain.len() / 2 > OUTPUT_RATE as usize * super::MAX_SECONDS {
                return Err("录音暂存超过长度上限".into());
            }
            samples.extend(
                plain
                    .chunks_exact(2)
                    .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / i16::MAX as f32),
            );
        }
        Ok(samples)
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RecoverableAudio {
        session_id: String,
        audio_ms: u64,
        error: Option<String>,
    }

    #[tauri::command]
    pub fn list_recoverable_audio(app: AppHandle) -> Result<Vec<RecoverableAudio>, String> {
        let mut found = Vec::new();
        for entry in fs::read_dir(spool_root(&app)?).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                continue;
            }
            if entry.path().join("history.keep").exists() {
                continue;
            }
            let session_id = entry.file_name().to_string_lossy().into_owned();
            let (audio_ms, error) = match read_session(&app, &session_id) {
                Ok(samples) => (samples.len() as u64 * 1000 / OUTPUT_RATE as u64, None),
                Err(message) => (0, Some(message)),
            };
            found.push(RecoverableAudio {
                session_id,
                audio_ms,
                error,
            });
        }
        found.sort_by(|a, b| b.session_id.cmp(&a.session_id));
        Ok(found)
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AudioDevice {
        id: String,
        name: String,
        is_default: bool,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SessionInfo {
        session_id: String,
        audio_ms: u64,
        sample_rate: u32,
        source_sample_rate: u32,
        device_error: Option<String>,
        transcript: Option<String>,
        transcription_error: Option<String>,
        asr_ms: u128,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LevelEvent {
        session_id: String,
        level: f32,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct DeviceErrorEvent {
        session_id: String,
        message: String,
    }

    struct Active {
        session_id: String,
        source_rate: u32,
        stream: cpal::Stream,
        worker: thread::JoinHandle<Result<CaptureResult, String>>,
        fault: Arc<Mutex<Option<String>>>,
        cancelled: Arc<AtomicBool>,
    }

    struct CaptureResult {
        samples: Vec<f32>,
        transcript: Option<String>,
        transcription_error: Option<String>,
        asr_ms: u128,
    }

    struct AsrJob {
        end: usize,
        samples: Vec<f32>,
    }
    struct AsrOutcome {
        end: usize,
        result: Result<crate::TranscribeResponse, String>,
    }
    #[derive(Default)]
    struct AsrProgress {
        committed: usize,
        partials: Vec<String>,
        pending: bool,
        failures: usize,
        last_error: Option<String>,
        asr_ms: u128,
    }
    impl AsrProgress {
        fn receive(&mut self, outcome: AsrOutcome) {
            self.pending = false;
            match outcome.result {
                Ok(response) if !response.text.trim().is_empty() => {
                    self.committed = outcome.end;
                    self.partials.push(response.text);
                    self.failures = 0;
                    self.asr_ms += response.duration_ms;
                    self.last_error = None;
                }
                Ok(_) => {
                    self.failures += 1;
                    self.last_error = Some("ASR 返回空文字".into());
                }
                Err(error) => {
                    self.failures += 1;
                    self.last_error = Some(error);
                }
            }
        }
    }

    #[derive(Default)]
    struct Store {
        active: Option<Active>,
        stopping: HashMap<String, Arc<AtomicBool>>,
    }
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    #[derive(Default)]
    struct RetryRequests {
        active: HashMap<String, Arc<AtomicBool>>,
        cancelled: HashSet<String>,
    }
    static RETRY_CANCEL: OnceLock<Mutex<RetryRequests>> = OnceLock::new();
    fn store() -> &'static Mutex<Store> {
        STORE.get_or_init(|| Mutex::new(Store::default()))
    }
    fn retry_cancel() -> &'static Mutex<RetryRequests> {
        RETRY_CANCEL.get_or_init(|| Mutex::new(RetryRequests::default()))
    }

    #[tauri::command]
    pub fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
        let host = cpal::default_host();
        let default_id = host.default_input_device().and_then(|d| d.id().ok());
        Ok(host
            .input_devices()
            .map_err(|e| format!("无法列出麦克风：{e}"))?
            .filter_map(|device| {
                let id = device.id().ok()?;
                Some(AudioDevice {
                    id: id.to_string(),
                    name: device.to_string(),
                    is_default: default_id.as_ref() == Some(&id),
                })
            })
            .collect::<Vec<_>>())
    }

    fn build_stream<T>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        tx: mpsc::SyncSender<Vec<f32>>,
        fault: Arc<Mutex<Option<String>>>,
    ) -> Result<cpal::Stream, String>
    where
        T: SizedSample + Sample + Send + 'static,
        f32: FromSample<T>,
    {
        let overflow = Arc::new(AtomicBool::new(false));
        let overflow_cb = overflow.clone();
        let error_fault = fault.clone();
        let overflow_fault = fault.clone();
        let error_tx = tx.clone();
        device
            .build_input_stream(
                *config,
                move |data: &[T], _| {
                    if overflow_cb.load(Ordering::Relaxed) {
                        return;
                    }
                    let packet = data
                        .iter()
                        .copied()
                        .map(|sample| sample.to_sample::<f32>())
                        .collect();
                    if tx.try_send(packet).is_err() {
                        overflow_cb.store(true, Ordering::Relaxed);
                        if let Ok(mut slot) = overflow_fault.lock() {
                            *slot = Some("录音处理跟不上设备输入，已保留此前音频".into());
                        }
                    }
                },
                move |error| {
                    if let Ok(mut slot) = error_fault.lock() {
                        *slot = Some(format!("麦克风中断：{error}"));
                    }
                    let _ = error_tx.try_send(Vec::new());
                },
                None,
            )
            .map_err(|e| format!("无法启动麦克风：{e}"))
    }

    fn capture_loop(
        rx: mpsc::Receiver<Vec<f32>>,
        app: AppHandle,
        session_id: String,
        source_rate: u32,
        channels: usize,
        fault: Arc<Mutex<Option<String>>>,
        cancelled: Arc<AtomicBool>,
        endpoint: String,
        model: String,
    ) -> Result<CaptureResult, String> {
        let (job_tx, job_rx) = mpsc::channel::<AsrJob>();
        let (outcome_tx, outcome_rx) = mpsc::channel::<AsrOutcome>();
        let uploader_cancelled = cancelled.clone();
        let uploader = thread::spawn(move || {
            while let Ok(job) = job_rx.recv() {
                if uploader_cancelled.load(Ordering::Relaxed) {
                    break;
                }
                let result = match wav_bytes(&job.samples) {
                    Ok(wav) => {
                        let mut result = Err("识别未执行".into());
                        for attempt in 0..2 {
                            if uploader_cancelled.load(Ordering::Relaxed) {
                                break;
                            }
                            result = tauri::async_runtime::block_on(
                                crate::transcribe_bytes_with_cancel(
                                    wav.clone(),
                                    "dictation.wav".into(),
                                    "audio/wav",
                                    endpoint.clone(),
                                    model.clone(),
                                    Some(uploader_cancelled.clone()),
                                ),
                            );
                            let transient = result.as_ref().err().is_some_and(|error| {
                                error.contains("语音识别请求失败")
                                    || ["HTTP 429", "HTTP 502", "HTTP 503", "HTTP 504"]
                                        .iter()
                                        .any(|code| error.contains(code))
                            });
                            if result.is_ok() || !transient || attempt == 1 {
                                break;
                            }
                            thread::sleep(Duration::from_millis(350));
                        }
                        result
                    }
                    Err(error) => Err(error),
                };
                if outcome_tx
                    .send(AsrOutcome {
                        end: job.end,
                        result,
                    })
                    .is_err()
                {
                    break;
                }
            }
        });

        let mut converter = Resampler::new(source_rate);
        let mut last_level = Instant::now();
        let mut last_evaluation = 0usize;
        let mut progress = AsrProgress::default();
        let spool = session_path(&app, &session_id)?;
        let mut spooled = 0usize;
        let mut sequence = 0usize;
        while let Ok(packet) = rx.recv() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            if fault.lock().ok().and_then(|slot| slot.clone()).is_some() {
                break;
            }
            let rms = match converter.push_interleaved(&packet, channels) {
                Ok(value) => value,
                Err(error) => {
                    if let Ok(mut slot) = fault.lock() {
                        *slot = Some(error);
                    }
                    break;
                }
            };
            if last_level.elapsed() >= Duration::from_millis(33) {
                let _ = app.emit(
                    "audio-level",
                    LevelEvent {
                        session_id: session_id.clone(),
                        level: (rms * 6.5).clamp(0.0, 1.0),
                    },
                );
                last_level = Instant::now();
            }
            if let Ok(outcome) = outcome_rx.try_recv() {
                progress.receive(outcome);
            }
            let total = converter.output.len();
            if total.saturating_sub(spooled) >= SPOOL_INTERVAL {
                if let Err(error) = write_chunk(&spool, sequence, &converter.output[spooled..total])
                {
                    if let Ok(mut slot) = fault.lock() {
                        *slot = Some(error);
                    }
                    break;
                }
                spooled = total;
                sequence += 1;
            }
            if !progress.pending
                && progress.failures < 2
                && total.saturating_sub(last_evaluation) >= OUTPUT_RATE as usize * 2
            {
                last_evaluation = total;
                if let Some(end) = pause_end(&converter.output, progress.committed) {
                    if job_tx
                        .send(AsrJob {
                            end,
                            samples: converter.output[progress.committed..end].to_vec(),
                        })
                        .is_ok()
                    {
                        progress.pending = true;
                    }
                }
            }
        }
        if cancelled.load(Ordering::Relaxed) {
            drop(job_tx);
            drop(uploader);
            return Err("录音已取消".into());
        }
        if let Some(message) = fault.lock().ok().and_then(|slot| slot.clone()) {
            let _ = app.emit(
                "audio-device-error",
                DeviceErrorEvent {
                    session_id: session_id.clone(),
                    message,
                },
            );
        }
        let samples = converter.finish();
        if samples.len() > spooled {
            write_chunk(&spool, sequence, &samples[spooled..])?;
        }
        let mut timed_out = false;
        if progress.pending {
            match outcome_rx.recv_timeout(Duration::from_secs(125)) {
                Ok(outcome) => progress.receive(outcome),
                Err(_) => {
                    progress.last_error = Some("录音中提交的识别段未能完成".into());
                    timed_out = true;
                }
            }
        }
        if !timed_out && has_voice(&samples[progress.committed..]) {
            if job_tx
                .send(AsrJob {
                    end: samples.len(),
                    samples: samples[progress.committed..].to_vec(),
                })
                .is_ok()
            {
                match outcome_rx.recv_timeout(Duration::from_secs(125)) {
                    Ok(outcome) => progress.receive(outcome),
                    Err(_) => {
                        progress.last_error = Some("尾段识别未能完成".into());
                        timed_out = true;
                    }
                }
            }
        }
        drop(job_tx);
        if !timed_out {
            let _ = uploader.join();
        }
        Ok(CaptureResult {
            samples,
            transcript: if progress.last_error.is_none() {
                Some(join_transcripts(&progress.partials))
            } else {
                None
            },
            transcription_error: progress.last_error,
            asr_ms: progress.asr_ms,
        })
    }

    #[tauri::command]
    pub fn start_audio_session(
        app: AppHandle,
        session_id: String,
        device_id: Option<String>,
        endpoint: String,
        model: String,
    ) -> Result<SessionInfo, String> {
        if session_id.is_empty() {
            return Err("录音会话缺少 ID".into());
        }
        let mut state = store().lock().map_err(|e| e.to_string())?;
        if state.active.is_some() {
            return Err("已有录音正在进行".into());
        }
        let spool = session_path(&app, &session_id)?;
        let host = cpal::default_host();
        let device = match device_id.filter(|id| !id.is_empty()) {
            Some(id) => {
                let parsed = id.parse().map_err(|e| format!("麦克风 ID 无效：{e}"))?;
                host.device_by_id(&parsed).ok_or("所选麦克风已断开")?
            }
            None => host.default_input_device().ok_or("未找到默认麦克风")?,
        };
        let supported = device
            .default_input_config()
            .map_err(|e| format!("无法获取麦克风格式：{e}"))?;
        let source_rate = supported.sample_rate();
        let channels = supported.channels() as usize;
        let format = supported.sample_format();
        let config = supported.into();
        let (tx, rx) = mpsc::sync_channel::<Vec<f32>>(32);
        let fault = Arc::new(Mutex::new(None));
        let stream = match format {
            SampleFormat::F32 => build_stream::<f32>(&device, &config, tx, fault.clone())?,
            SampleFormat::I16 => build_stream::<i16>(&device, &config, tx, fault.clone())?,
            SampleFormat::U16 => build_stream::<u16>(&device, &config, tx, fault.clone())?,
            SampleFormat::I32 => build_stream::<i32>(&device, &config, tx, fault.clone())?,
            other => return Err(format!("麦克风格式暂不支持：{other}")),
        };
        fs::create_dir(&spool).map_err(|e| format!("无法创建录音暂存：{e}"))?;
        let worker_id = session_id.clone();
        let worker_fault = fault.clone();
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_cancelled = cancelled.clone();
        let worker = thread::spawn(move || {
            capture_loop(
                rx,
                app,
                worker_id,
                source_rate,
                channels,
                worker_fault,
                worker_cancelled,
                endpoint,
                model,
            )
        });
        if let Err(error) = stream.play() {
            drop(stream);
            let _ = worker.join();
            let _ = fs::remove_dir_all(spool);
            return Err(format!("无法开始录音：{error}"));
        }
        state.active = Some(Active {
            session_id: session_id.clone(),
            source_rate,
            stream,
            worker,
            fault,
            cancelled,
        });
        Ok(SessionInfo {
            session_id,
            audio_ms: 0,
            sample_rate: OUTPUT_RATE,
            source_sample_rate: source_rate,
            device_error: None,
            transcript: None,
            transcription_error: None,
            asr_ms: 0,
        })
    }

    #[tauri::command]
    pub async fn stop_audio_session(
        app: AppHandle,
        session_id: String,
    ) -> Result<SessionInfo, String> {
        tauri::async_runtime::spawn_blocking(move || stop_audio_session_inner(app, session_id))
            .await
            .map_err(|error| format!("录音处理线程失败：{error}"))?
    }

    fn stop_audio_session_inner(app: AppHandle, session_id: String) -> Result<SessionInfo, String> {
        let active = {
            let mut state = store().lock().map_err(|e| e.to_string())?;
            if state.active.as_ref().map(|a| a.session_id.as_str()) != Some(session_id.as_str()) {
                return Err("录音会话已结束".into());
            }
            let active = state.active.take().ok_or("录音会话已结束")?;
            state
                .stopping
                .insert(session_id.clone(), active.cancelled.clone());
            active
        };
        let Active {
            source_rate,
            stream,
            worker,
            fault,
            ..
        } = active;
        drop(stream);
        let outcome = worker.join().map_err(|_| "录音处理线程异常退出")?;
        let mut state = store().lock().map_err(|e| e.to_string())?;
        let was_cancelled = state
            .stopping
            .remove(&session_id)
            .is_some_and(|flag| flag.load(Ordering::Relaxed));
        if was_cancelled {
            if let Ok(path) = session_path(&app, &session_id) {
                let _ = fs::remove_dir_all(path);
            }
            return Err("录音已取消".into());
        }
        let CaptureResult {
            samples,
            transcript,
            transcription_error,
            asr_ms,
        } = outcome?;
        if samples.len() < (OUTPUT_RATE as usize * 3 / 10) {
            return Err("录音太短，请多说几个字后再结束".into());
        }
        let audio_ms = (samples.len() as u64 * 1000) / OUTPUT_RATE as u64;
        let device_error = fault.lock().ok().and_then(|s| s.clone());
        Ok(SessionInfo {
            session_id,
            audio_ms,
            sample_rate: OUTPUT_RATE,
            source_sample_rate: source_rate,
            device_error,
            transcript,
            transcription_error,
            asr_ms,
        })
    }

    #[tauri::command]
    pub fn cancel_audio_session(app: AppHandle, session_id: String) -> Result<(), String> {
        if let Ok(mut retries) = retry_cancel().lock() {
            retries.cancelled.insert(session_id.clone());
            if let Some(flag) = retries.active.get(&session_id) {
                flag.store(true, Ordering::Relaxed);
            }
            if retries.cancelled.len() > 128 {
                retries.cancelled = retries.cancelled.iter().take(64).cloned().collect();
            }
        }
        let (active, was_stopping) = {
            let mut state = store().lock().map_err(|e| e.to_string())?;
            let was_stopping = state.stopping.contains_key(&session_id);
            if let Some(flag) = state.stopping.get(&session_id) {
                flag.store(true, Ordering::Relaxed);
            }
            (
                if state.active.as_ref().map(|a| a.session_id.as_str()) == Some(session_id.as_str())
                {
                    state.active.take()
                } else {
                    None
                },
                was_stopping,
            )
        };
        if let Some(active) = active {
            active.cancelled.store(true, Ordering::Relaxed);
            drop(active.stream);
            // Keep cancellation immediate, then clean after the writer exits.
            thread::spawn(move || {
                let _ = active.worker.join();
                if let Ok(path) = session_path(&app, &session_id) {
                    let _ = fs::remove_dir_all(path);
                }
            });
        } else if !was_stopping {
            if let Ok(path) = session_path(&app, &session_id) {
                let _ = fs::remove_dir_all(path);
            }
        }
        Ok(())
    }

    #[tauri::command]
    pub fn release_native_audio(app: AppHandle, session_id: String) -> Result<(), String> {
        let path = session_path(&app, &session_id)?;
        if path.exists() {
            fs::remove_dir_all(path).map_err(|e| format!("清理录音暂存失败：{e}"))?;
        }
        Ok(())
    }

    #[tauri::command]
    pub fn retain_native_audio(app: AppHandle, session_id: String) -> Result<(), String> {
        read_session(&app, &session_id)?;
        let path = session_path(&app, &session_id)?.join("history.keep");
        fs::write(path, b"1").map_err(|e| format!("保留历史录音失败：{e}"))
    }

    #[tauri::command]
    pub fn cleanup_history_audio(
        app: AppHandle,
        kept_session_ids: Vec<String>,
    ) -> Result<(), String> {
        let kept: std::collections::HashSet<_> = kept_session_ids.into_iter().collect();
        for entry in fs::read_dir(spool_root(&app)?).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_dir()
                || !entry.path().join("history.keep").exists()
            {
                continue;
            }
            let session_id = entry.file_name().to_string_lossy().into_owned();
            if !kept.contains(&session_id) {
                // A history write may have failed after the audio was marked.
                // Expose this orphan as recoverable instead of deleting it.
                fs::remove_file(entry.path().join("history.keep"))
                    .map_err(|e| format!("恢复孤立录音失败：{e}"))?;
            }
        }
        Ok(())
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct NativeTranscribeRequest {
        session_id: String,
        request_id: String,
        endpoint: String,
        model: String,
    }

    #[tauri::command]
    pub async fn transcribe_native_audio(
        app: AppHandle,
        request: NativeTranscribeRequest,
    ) -> Result<crate::TranscribeResponse, String> {
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut retries = retry_cancel().lock().map_err(|e| e.to_string())?;
            if retries.cancelled.remove(&request.request_id) {
                return Err("录音已取消".into());
            }
            retries
                .active
                .insert(request.request_id.clone(), cancelled.clone());
        }
        let session_id = request.session_id.clone();
        let result = async {
            let samples =
                tauri::async_runtime::spawn_blocking(move || read_session(&app, &session_id))
                    .await
                    .map_err(|e| format!("读取录音暂存失败：{e}"))??;
            if cancelled.load(Ordering::Relaxed) {
                return Err("录音已取消".into());
            }
            let wav = wav_bytes(&samples)?;
            crate::transcribe_bytes_with_cancel(
                wav,
                "dictation.wav".into(),
                "audio/wav",
                request.endpoint,
                request.model,
                Some(cancelled),
            )
            .await
        }
        .await;
        if let Ok(mut retries) = retry_cancel().lock() {
            retries.active.remove(&request.request_id);
            retries.cancelled.remove(&request.request_id);
        }
        result
    }
}

#[cfg(not(windows))]
mod platform {
    use serde::Serialize;
    use tauri::AppHandle;
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AudioDevice {
        id: String,
        name: String,
        is_default: bool,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SessionInfo {
        session_id: String,
        audio_ms: u64,
        sample_rate: u32,
        source_sample_rate: u32,
        device_error: Option<String>,
        transcript: Option<String>,
        transcription_error: Option<String>,
        asr_ms: u128,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct NativeTranscribeRequest {
        session_id: String,
        endpoint: String,
        model: String,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RecoverableAudio {
        session_id: String,
        audio_ms: u64,
        error: Option<String>,
    }
    #[tauri::command]
    pub fn list_recoverable_audio() -> Result<Vec<RecoverableAudio>, String> {
        Ok(Vec::new())
    }
    #[tauri::command]
    pub fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
        Err("原生录音仅支持 Windows".into())
    }
    #[tauri::command]
    pub fn start_audio_session(
        _app: AppHandle,
        _session_id: String,
        _device_id: Option<String>,
        _endpoint: String,
        _model: String,
    ) -> Result<SessionInfo, String> {
        Err("原生录音仅支持 Windows".into())
    }
    #[tauri::command]
    pub fn stop_audio_session(_session_id: String) -> Result<SessionInfo, String> {
        Err("原生录音仅支持 Windows".into())
    }
    #[tauri::command]
    pub fn cancel_audio_session(_session_id: String) -> Result<(), String> {
        Ok(())
    }
    #[tauri::command]
    pub fn release_native_audio(_session_id: String) -> Result<(), String> {
        Ok(())
    }
    #[tauri::command]
    pub fn retain_native_audio(_session_id: String) -> Result<(), String> {
        Ok(())
    }
    #[tauri::command]
    pub fn cleanup_history_audio(_kept_session_ids: Vec<String>) -> Result<(), String> {
        Ok(())
    }
    #[tauri::command]
    pub async fn transcribe_native_audio(
        _request: NativeTranscribeRequest,
    ) -> Result<crate::TranscribeResponse, String> {
        Err("原生录音仅支持 Windows".into())
    }
}

pub use platform::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampling_is_independent_of_callback_boundaries() {
        let input: Vec<f32> = (0..48_000)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48_000.0).sin())
            .collect();
        let mut whole = Resampler::new(48_000);
        whole.push_interleaved(&input, 1).unwrap();
        let whole = whole.finish();
        let mut sliced = Resampler::new(48_000);
        for chunk in input.chunks(317) {
            sliced.push_interleaved(chunk, 1).unwrap();
        }
        let sliced = sliced.finish();
        assert_eq!(whole.len(), sliced.len());
        assert!((whole.len() as isize - 16_000).abs() <= 1);
        assert!(whole
            .iter()
            .zip(sliced.iter())
            .all(|(a, b)| (a - b).abs() < 1e-5));
    }

    #[test]
    fn segments_only_at_a_pause() {
        let rate = OUTPUT_RATE as usize;
        let voiced = vec![0.08f32; rate * 7];
        assert!(pause_end(&voiced, 0).is_none());
        let mut paused = voiced;
        paused[rate * 5..rate * 6].fill(0.0);
        assert!(pause_end(&paused, 0)
            .is_some_and(|position| position >= rate * 5 && position < rate * 6));
        assert!(pause_end(&paused[..rate * 4], 0).is_none());
    }

    #[test]
    fn wav_header_describes_actual_pcm_payload() {
        let bytes = wav_bytes(&[0.0, 1.0, -1.0]).unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 6);
        assert_eq!(bytes.len(), 50);
    }
}
