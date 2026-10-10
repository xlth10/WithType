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

pub(crate) fn wav_bytes(samples: &[f32]) -> Result<Vec<u8>, String> {
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

/// 单个样本超过这个振幅才算「有信号」（约 −48 dBFS）。
/// 数字静音、近静音的抖动（|v| ≤ 2/32768）、被系统静音的麦克风都在它之下。
const SILENCE_FLOOR: f32 = 0.004;

/// 有信号样本占比低于这个数就按「没采到音频」处理。
///
/// 用占比而不是整段 RMS：RMS 会被孤立的单个尖峰抬高（0.5 的尖峰落在
/// 8000 个零样本里就能把 RMS 顶到 0.0056），而那种录音发给上游同样只会
/// 换回凭空生成的文字。占比对尖峰免疫，且不随时长漂移。
///
/// 取值刻意保守。这道门返回 Err 会**扣住**一次本来正确的转写（音频仍可从
/// 「可恢复录音」重试），所以假阳性的代价高于假阴性：宁可漏掉一段疑似静音，
/// 也不要把「录了 60 秒、只说了一句话」的正常录音判成没声音（那约 5%，
/// 已经在门之上）。据此只拦真正无歧义的形状：整段数字静音、近静音抖动、
/// 以及静音里混进的孤立尖峰——都远低于 1%。
const SILENCE_VOICED_FRACTION: f32 = 0.01;

/// 只用于给出提示，不参与任何录音决策：说话的录音不会被它拦下。
///
/// `pub(crate)` 是因为 `lib.rs` 的 `probe_wav` 测试要断言探针音频确实能过
/// 这道本地静音门——探针一旦退化成数字静音，上游就会稳定返回 500。
pub(crate) fn is_silent(samples: &[f32]) -> bool {
    if samples.is_empty() {
        return true;
    }
    let voiced = samples
        .iter()
        .filter(|sample| sample.abs() > SILENCE_FLOOR)
        .count();
    (voiced as f32 / samples.len() as f32) < SILENCE_VOICED_FRACTION
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
    use super::{has_voice, is_silent, join_transcripts, pause_end, wav_bytes, Resampler, OUTPUT_RATE};
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
            atomic::{AtomicBool, AtomicU64, Ordering},
            mpsc, Arc, Mutex, OnceLock,
        },
        thread,
        time::{Duration, Instant},
    };
    use tauri::{AppHandle, Emitter, Manager};

    const SPOOL_INTERVAL: usize = OUTPUT_RATE as usize * 2;
    const SPOOL_MAGIC: &[u8; 4] = b"TFA1";

    /// 可恢复警告的类别码：没出现过。
    pub(super) const WARNING_NONE: u64 = 0;
    /// 可恢复警告的类别码：设备报告了一次数据不连续（WASAPI 的 Xrun）。
    pub(super) const WARNING_DATA_DISCONTINUITY: u64 = 1;

    /// 把 cpal 的错误类别搬到 `u64` 上，好让实时回调只做原子自增。
    /// 只有真正能自愈的那一类才算警告；其余一律按致命处理，
    /// 宁可多停一次，也不把设备拔出当噪声吞掉。
    fn warning_kind(error: &cpal::Error) -> u64 {
        match error.kind() {
            cpal::ErrorKind::Xrun => WARNING_DATA_DISCONTINUITY,
            _ => WARNING_NONE,
        }
    }

    /// 采集诊断计数。设备回调在实时音频线程上，不能在那里加锁或格式化字符串，
    /// 所以回调只做两次原子自增；阈值判定与文案生成都留给 capture_loop。
    /// 这些数字只描述「设备送没送数据、送了多少帧」，不含任何音频内容，
    /// 因此可以安全地回给前端看（见 text_api 的约束：不回显密钥与服务端响应体）。
    #[derive(Default)]
    struct CaptureProbeAtoms {
        /// 数据回调被调用的次数。
        callbacks: AtomicU64,
        /// 数据回调累计带来的采样帧数（已除以声道数）。
        frames: AtomicU64,
        /// 错误回调被调用的次数。
        error_callbacks: AtomicU64,
        /// 其中可恢复警告（Xrun 等）出现了几次。类别码另存一栏：
        /// 实时线程不格式化字符串，只搬数字。
        recoverable: AtomicU64,
        /// 第一种可恢复警告的类别码，`WARNING_NONE` 表示没出现过。
        recoverable_kind: AtomicU64,
    }

    impl CaptureProbeAtoms {
        fn snapshot(&self) -> CaptureProbe {
            CaptureProbe {
                callbacks: self.callbacks.load(Ordering::Relaxed),
                frames: self.frames.load(Ordering::Relaxed),
                error_callbacks: self.error_callbacks.load(Ordering::Relaxed),
                recoverable: self.recoverable.load(Ordering::Relaxed),
                recoverable_kind: self.recoverable_kind.load(Ordering::Relaxed),
            }
        }
    }

    /// 一次会话结束时留下的采集读数。
    /// `pub(super)`：单元测试在 `audio::tests`（platform 的兄弟模块）里，
    /// 要直接把一份读数喂给 `capture_diagnostics` 断言四种现场各有各的说法。
    #[derive(Clone, Copy, Default)]
    pub(super) struct CaptureProbe {
        pub(super) callbacks: u64,
        pub(super) frames: u64,
        pub(super) error_callbacks: u64,
        /// 错误回调里属于「可恢复警告」的次数（见 `warning_kind`）。
        pub(super) recoverable: u64,
        /// 第一次出现的可恢复警告类别码，`WARNING_NONE` 表示没有。
        pub(super) recoverable_kind: u64,
    }

    /// 会话最后一次真的采到可用音频时的读数，用来给用户一个可比较的基准。
    /// 判据是「采集侧产出了足够的样本」，不是「用户是否保留文件」——
    /// 关掉保留开关后的正常录音同样不留文件，拿文件判断会把好会话当成坏会话。
    /// 只存最新一份：诊断只需要「上一次好的是什么样」，用来对照这次差在哪。
    static LAST_CAPTURE_PROBE: OnceLock<Mutex<Option<CaptureProbe>>> = OnceLock::new();

    fn last_capture_probe() -> &'static Mutex<Option<CaptureProbe>> {
        LAST_CAPTURE_PROBE.get_or_init(|| Mutex::new(None))
    }

    /// 有可恢复警告（设备报告过数据不连续）时的一句话说明。
    ///
    /// `live` 为真表示采集还在进行：这是给用户看的即时通知，措辞要说明「还在录」，
    /// 避免用户以为已经失败。为假表示这是收尾时拼进诊断的补充说明。
    /// 没有出现过警告就返回 `None`。
    /// `pub(super)`：见 `CaptureProbe` 上的说明。
    pub(super) fn recoverable_warning(probe: &CaptureProbe, live: bool) -> Option<String> {
        if probe.recoverable == 0 {
            return None;
        }
        let name = match probe.recoverable_kind {
            WARNING_DATA_DISCONTINUITY => "设备报告了一次数据不连续",
            _ => "设备报告了一次可自行恢复的警告",
        };
        Some(if live {
            format!("{name}（{n} 次），录音已继续", n = probe.recoverable)
        } else {
            format!("{name}（{n} 次），已继续录音", n = probe.recoverable)
        })
    }

    /// 回落到「录音太短」之前，先看看有没有更具体的采集侧证据。
    ///
    /// 存在的理由：`capture_loop` 只把设备故障写进 `fault`，而
    /// `stop_audio_session_inner` 遇到空样本就直接回「录音太短」——
    /// 真实原因在那一层被吞掉。这里在没有 fault 时自己补一条，
    /// 依据是实时回调的计数，据此区分三种完全不同的故障：
    ///   1. 数据回调一次都没触发 → 设备（或驱动）没有为这条流供数；
    ///   2. 回调触发了但一帧都没带 → 设备给的是空缓冲；
    ///   3. 采到了帧，只是不够 300 ms → 是用户按得太快，不是故障。
    /// `pub(super)`：见 `CaptureProbe` 上的说明。
    pub(super) fn capture_diagnostics(
        fault: &Arc<Mutex<Option<String>>>,
        probe: &CaptureProbe,
        sample_count: usize,
        channels: usize,
    ) -> Option<String> {
        // 有真实故障就以它为准：那是最具体的证据。
        if let Some(message) = fault.lock().ok().and_then(|slot| slot.clone()) {
            return Some(format!(
                "{message}（设备回调 {callbacks} 次、累计 {frames} 帧；声道 {channels}）",
                callbacks = probe.callbacks,
                frames = probe.frames,
            ));
        }
        // 没故障、样本也够，就不是故障，不必打扰用户。
        if sample_count >= OUTPUT_RATE as usize * 3 / 10 {
            return None;
        }
        let mut message = if probe.callbacks == 0 {
            if probe.error_callbacks > 0 {
                format!(
                    "麦克风没有送出任何音频：错误回调触发了 {errors} 次，但没有收到过音频数据",
                    errors = probe.error_callbacks
                )
            } else {
                "麦克风没有送出任何音频：音频回调一次都没有触发（设备可能未被驱动供数）"
                    .to_string()
            }
        } else if probe.frames < PROBE_MIN_FRAMES {
            format!(
                "麦克风送来的都是空缓冲：音频回调触发了 {callbacks} 次，却一帧采样都没带",
                callbacks = probe.callbacks
            )
        } else {
            format!(
                "只采到 {ms} 毫秒音频（16 kHz 输出，设备 {channels} 声道；回调 {callbacks} 次、{frames} 帧）",
                ms = sample_count as u64 * 1000 / OUTPUT_RATE as u64,
                callbacks = probe.callbacks,
                frames = probe.frames,
            )
        };
        if probe.error_callbacks > 0 && probe.callbacks != 0 {
            // callbacks == 0 时上一段已经报过错误回调次数，不重复。
            message.push_str(&format!("；错误回调 {errors} 次", errors = probe.error_callbacks));
        }
        // 设备抖动是可自愈的，但它正好解释了「为什么只采到这么点」：
        // 与前面那些计数并列写出，用户才知道该去查哪一头。
        if let Some(warning) = recoverable_warning(probe, false) {
            message.push_str(&format!("；{warning}"));
        }
        // 有上一次成功录音的读数就直接对比：用户一眼能看出这次差在哪里。
        if let Ok(previous) = last_capture_probe().lock() {
            if let Some(last) = *previous {
                message.push_str(&format!(
                    "。上一次正常录音：回调 {callbacks} 次、{frames} 帧",
                    callbacks = last.callbacks,
                    frames = last.frames,
                ));
            }
        }
        Some(message)
    }

    /// 回调来了却一个采样帧都没带，就用这个下限当作「设备没有产出可录音的数据」。
    /// 判据就是「一帧都没带」：设备只要送来过哪怕 1 帧，就说明它在供数，
    /// 之后采不够就只是时间太短，不是空缓冲。取 1 而不是 0，是为了让比较写成
    /// `frames < PROBE_MIN_FRAMES`——`frames == 0` 恰在下限之下，正是空缓冲。
    /// `pub(super)`：单元的断言要守住这个下限（它必须 ≤ 1，见 capture_evidence）。
    pub(super) const PROBE_MIN_FRAMES: u64 = 1;

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
        // 恢复/重试链路的唯一汇合点（list_recoverable_audio / retain_native_audio /
        // transcribe_native_audio 都走这里）。全是静音的录音发给服务端只会换回
        // 一段凭空生成的文字，不如在本地就说清楚。
        // 注意用 is_silent（有信号样本占比）而不是 has_voice（单点峰值）：
        // 近静音但混进一个尖峰的录音会返回幻觉文字，那才是这条链路真正要拦的东西。
        if is_silent(&samples) {
            return Err("录音里没有采集到有效声音".into());
        }
        Ok(samples)
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RecoverableAudio {
        session_id: String,
        audio_ms: u64,
        error: Option<String>,
        /// 开始录音时的意图。恢复面板靠它把「重新转写」路由回原路径——
        /// 重启后前端的 pendingFailure 已丢，磁盘上这一份是唯一来源。
        intent: Option<String>,
    }

    #[tauri::command]
    pub async fn list_recoverable_audio(app: AppHandle) -> Result<Vec<RecoverableAudio>, String> {
        // 遍历 spool 会做多次磁盘 IO（读每个会话的 wav 头），放阻塞线程，
        // 避免主线程被慢盘拖住。
        tauri::async_runtime::spawn_blocking(move || list_recoverable_audio_inner(app))
            .await
            .map_err(|error| format!("读取可恢复录音线程失败：{error}"))?
    }

    fn list_recoverable_audio_inner(app: AppHandle) -> Result<Vec<RecoverableAudio>, String> {
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
            let intent = fs::read_to_string(entry.path().join("intent.txt"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let (audio_ms, error) = match read_session(&app, &session_id) {
                Ok(samples) => (samples.len() as u64 * 1000 / OUTPUT_RATE as u64, None),
                Err(message) => (0, Some(message)),
            };
            found.push(RecoverableAudio {
                session_id,
                audio_ms,
                error,
                intent,
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
        /// 采集侧现场读数：样本为 0（或异常少）时，它是唯一能说明「为什么」的东西。
        diagnostics: Option<String>,
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
    pub async fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
        // WASAPI 枚举设备会做 COM 初始化与多次 IO，放阻塞线程，避免主线程卡顿。
        tauri::async_runtime::spawn_blocking(|| {
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
        })
        .await
        .map_err(|error| format!("枚举麦克风线程失败：{error}"))?
    }

    fn build_stream<T>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        channels: usize,
        tx: mpsc::SyncSender<Vec<f32>>,
        fault: Arc<Mutex<Option<String>>>,
        probe: Arc<CaptureProbeAtoms>,
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
        let error_probe = probe.clone();
        let data_probe = probe;
        let frames_per_callback = channels.max(1) as u64;
        device
            .build_input_stream(
                *config,
                move |data: &[T], _| {
                    // 实时音频线程：只自增，不加锁、不分配、不格式化。
                    data_probe.callbacks.fetch_add(1, Ordering::Relaxed);
                    data_probe
                        .frames
                        .fetch_add(data.len() as u64 / frames_per_callback, Ordering::Relaxed);
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
                    // 错误回调也在实时线程上：这里仍然只做原子自增，不格式化字符串。
                    // 计数用来区分「回调压根没装」「回调装了、设备直接报错」与
                    // 「回调装了、只是报了一次可自愈的警告」，三者修法不同。
                    error_probe.error_callbacks.fetch_add(1, Ordering::Relaxed);
                    let kind = warning_kind(&error);
                    if kind == WARNING_NONE {
                        // 真正的故障：写进 fault，采集循环会停下来。
                        if let Ok(mut slot) = error_fault.lock() {
                            *slot = Some(format!("麦克风中断：{error}"));
                        }
                        let _ = error_tx.try_send(Vec::new());
                        return;
                    }
                    // 可恢复警告：只记数、只提示，绝不写 fault。
                    //
                    // 依据 cpal 0.18.2 的 WASAPI 后端：Xrun 只在设备报告
                    // AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY 时发出，而且 cpal 自己
                    // 丢弃了这次上报的返回值，紧接着照常调用 data_callback —— 它把
                    // 这一档当作可以继续跑的警告，不是流已失效。设备刚打开时最易出现
                    // （引擎重配、路由切换），此后通常就不再出现。
                    // 过去这里把它和致命错误一起写进 fault，采集循环下一轮立刻 break，
                    // 于是一次刚开头的抖动就把整段录音掐掉，用户念的字一个都没采到。
                    error_probe.recoverable.fetch_add(1, Ordering::Relaxed);
                    if error_probe.recoverable_kind.load(Ordering::Relaxed) == WARNING_NONE {
                        error_probe
                            .recoverable_kind
                            .store(kind, Ordering::Relaxed);
                    }
                    // 错误回调可能早于采集线程第一次取 packet；用空 packet 把它叫醒，
                    // 让「本次录音出现过设备抖动」这条通知尽快发出去。
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
        probe: Arc<CaptureProbeAtoms>,
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
        let mut warning_emitted = false;
        while let Ok(packet) = rx.recv() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            if fault.lock().ok().and_then(|slot| slot.clone()).is_some() {
                break;
            }
            if packet.is_empty() {
                // 只有两种东西会送空 packet：可恢复警告的唤醒，以及同步声道的分帧。
                // 两者都只轮到发「设备抖动」这一条通知——它不是错误，只是一个
                // 可能对不上字的瞬间，用户知道就够了，不该中断采集。
                // 走的必须是 warning 频道，不能借 error 频道：前端对
                // audio-device-error 的处理是「提示 + 停掉本次录音」，
                // 把可自愈的抖动发过去，等于绕一圈又把它变回中断。
                if !warning_emitted {
                    let readings = probe.snapshot();
                    if let Some(message) = recoverable_warning(&readings, true) {
                        let _ = app.emit(
                            "audio-device-warning",
                            DeviceErrorEvent {
                                session_id: session_id.clone(),
                                message,
                            },
                        );
                        warning_emitted = true;
                    }
                }
                continue;
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
        // 顺序不能反：capture_diagnostics 会读上一次的基准读数与本次对比，
        // 先写基准的话，这次就会变成和它自己比较。
        let readings = probe.snapshot();
        let diagnostics = capture_diagnostics(&fault, &readings, samples.len(), channels);
        if samples.len() >= OUTPUT_RATE as usize * 3 / 10 {
            if let Ok(mut previous) = last_capture_probe().lock() {
                *previous = Some(readings);
            }
        }
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
        if !timed_out && progress.failures < 2 && has_voice(&samples[progress.committed..]) {
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
        // 尾段识别失败时，只要录音中已经攒到部分结果，就降级返回它们：
        // 主循环里的失败预算（failures < 2）意味着走到这里时大概率已重试过，
        // 把已确认的几段一并丢掉只会让用户整句重说。
        // transcription_error 必须同时清空：前端 pipeline 先检查它就会整条报错，
        // 拿不到降级后的 transcript。
        let degraded = progress.last_error.is_some() && !progress.partials.is_empty();
        Ok(CaptureResult {
            samples,
            transcript: if progress.last_error.is_none() || degraded {
                Some(join_transcripts(&progress.partials))
            } else {
                None
            },
            transcription_error: if degraded { None } else { progress.last_error },
            asr_ms: progress.asr_ms,
            diagnostics,
        })
    }

    #[tauri::command]
    pub async fn start_audio_session(
        app: AppHandle,
        session_id: String,
        device_id: Option<String>,
        endpoint: String,
        model: String,
        intent: Option<String>,
    ) -> Result<SessionInfo, String> {
        // 设备探测、spool 创建、流构建都会做 COM/IO，放阻塞线程，避免主线程被
        // 蓝牙麦克风的冷启动（重连、格式协商）拖住几秒。
        tauri::async_runtime::spawn_blocking(move || {
            start_audio_session_inner(app, session_id, device_id, endpoint, model, intent)
        })
        .await
        .map_err(|error| format!("录音启动线程失败：{error}"))?
    }

    fn start_audio_session_inner(
        app: AppHandle,
        session_id: String,
        device_id: Option<String>,
        endpoint: String,
        model: String,
        intent: Option<String>,
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
        let probe = Arc::new(CaptureProbeAtoms::default());
        let stream = match format {
            SampleFormat::F32 => {
                build_stream::<f32>(&device, &config, channels, tx, fault.clone(), probe.clone())?
            }
            SampleFormat::I16 => {
                build_stream::<i16>(&device, &config, channels, tx, fault.clone(), probe.clone())?
            }
            SampleFormat::U16 => {
                build_stream::<u16>(&device, &config, channels, tx, fault.clone(), probe.clone())?
            }
            SampleFormat::I32 => {
                build_stream::<i32>(&device, &config, channels, tx, fault.clone(), probe.clone())?
            }
            other => return Err(format!("麦克风格式暂不支持：{other}")),
        };
        fs::create_dir(&spool).map_err(|e| format!("无法创建录音暂存：{e}"))?;
        // 意图写进 spool：应用重启后 list_recoverable_audio 靠它恢复这条录音的路径。
        // 写失败不阻断录音——丢了它恢复时按听写处理，只是路径可能不对。
        if let Some(intent) = intent.filter(|value| !value.trim().is_empty()) {
            let _ = fs::write(spool.join("intent.txt"), intent.trim());
        }
        let worker_id = session_id.clone();
        let worker_fault = fault.clone();
        let worker_probe = probe.clone();
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
                worker_probe,
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
            diagnostics,
        } = outcome?;
        if samples.len() < (OUTPUT_RATE as usize * 3 / 10) {
            // 这条早返回过去只说「录音太短」，把采集侧的真实原因整条吞掉：
            // device_error 在下面几行才读，永远读不到。诊断现在随结果一起过来，
            // 直接并进消息里，前端就能看到「是设备没供数、还是空缓冲、还是按太快」。
            let detail = match diagnostics.as_deref() {
                Some(message) => format!("录音太短，请多说几个字后再结束（{message}）"),
                None => "录音太短，请多说几个字后再结束".to_string(),
            };
            // 一个采样都没有时暂存目录必然是空的，留着只会每次失败积一个空目录。
            // 有内容就不动：那仍可能被「可恢复录音」用上。
            if samples.is_empty() {
                if let Ok(path) = session_path(&app, &session_id) {
                    let _ = fs::remove_dir_all(path);
                }
            }
            return Err(detail);
        }
        // 这里只影响提示文案：录音没有被丢弃，仍可从「可恢复录音」里重试。
        // 因此不用 has_voice（单点峰值）——那会在用户小声说话时误报。
        if is_silent(&samples) {
            return Err("录音里没有采集到有效声音".into());
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
    pub async fn release_native_audio(app: AppHandle, session_id: String) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || release_native_audio_inner(app, session_id))
            .await
            .map_err(|error| format!("清理录音线程失败：{error}"))?
    }

    fn release_native_audio_inner(app: AppHandle, session_id: String) -> Result<(), String> {
        let path = session_path(&app, &session_id)?;
        if path.exists() {
            fs::remove_dir_all(path).map_err(|e| format!("清理录音暂存失败：{e}"))?;
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn retain_native_audio(app: AppHandle, session_id: String) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || retain_native_audio_inner(app, session_id))
            .await
            .map_err(|error| format!("保留录音线程失败：{error}"))?
    }

    fn retain_native_audio_inner(app: AppHandle, session_id: String) -> Result<(), String> {
        read_session(&app, &session_id)?;
        let path = session_path(&app, &session_id)?.join("history.keep");
        fs::write(path, b"1").map_err(|e| format!("保留历史录音失败：{e}"))
    }

    #[tauri::command]
    pub async fn cleanup_history_audio(
        app: AppHandle,
        kept_session_ids: Vec<String>,
    ) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || cleanup_history_audio_inner(app, kept_session_ids))
            .await
            .map_err(|error| format!("清理历史录音线程失败：{error}"))?
    }

    fn cleanup_history_audio_inner(
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
        intent: Option<String>,
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
        _intent: Option<String>,
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

    /// 静音判定是「只给提示、不参与决策」的：阈值必须低到不会拦下正常说话。
    #[test]
    fn silence_gate_never_trips_on_real_speech_levels() {
        assert!(is_silent(&[]));
        assert!(is_silent(&vec![0.0f32; 8_000]));

        // 一场连续说话录制里，整段 RMS 通常不低于 −30 dBFS；轻声说话也远高于阈值。
        let speech = vec![0.03f32; 8_000]; // RMS 0.03 ≈ −30 dBFS，峰值 0.03
        assert!(!is_silent(&speech), "轻声说话不能被判成静音");

        // 只有一半时间在说话，另一半是数字静音，有信号占比仍是 50%。
        let mut half = vec![0.0f32; 8_000];
        half[..4_000].fill(0.03);
        assert!(!is_silent(&half));
    }

    #[test]
    fn silence_gate_trips_on_what_the_service_would_misread() {
        // 近静音抖动（|v| = 2/32768 ≈ 6e-5）全部落在 SILENCE_FLOOR 之下，
        // 会被上游幻觉成文字，本地就该拦下。
        let dither: Vec<f32> = (0..8_000)
            .map(|index| if index % 2 == 0 { 2.0 / 32_768.0 } else { -2.0 / 32_768.0 })
            .collect();
        assert!(is_silent(&dither));

        // 麦克风被系统静音：样本压根没变过。
        assert!(is_silent(&vec![0.0f32; 8_000]));

        // 整段静音里混进一个尖峰：has_voice（峰值判定）会放行，is_silent 必须拦住。
        // 单个样本的贡献是 1/8000 = 0.0125%，远低于 SILENCE_VOICED_FRACTION。
        let mut spiked = vec![0.0f32; 8_000];
        spiked[4_000] = 0.5;
        assert!(has_voice(&spiked));
        assert!(is_silent(&spiked), "孤立尖峰不该被算成有效声音");

        // 这点很关键：整段 RMS 会被这个尖峰抬到 0.0056，高过任何合理的
        // RMS 阈值——所以这里刻意用占比，而不是 RMS。
        let rms = (spiked.iter().map(|s| s * s).sum::<f32>() / spiked.len() as f32).sqrt();
        assert!(rms > 0.004, "尖峰确实能把 RMS 顶过阈值（实测 {rms}）");
    }

    /// 真实录音里确实会出现的形状：3 秒数字静音（麦克风打开但用户没说话）
/// 加 0.1 秒的 300 Hz 撞击（合上笔记本、碰到桌面）。
    ///
    /// 这道门**刻意放它过去**：0.1 秒是 3 秒的 3.3%，已经在
    /// `SILENCE_VOICED_FRACTION` 之上。假阳性（扣下一次正确转写）的代价高于
    /// 假阴性，所以只拦真正无歧义的形状。这也说明它不是一个改头换面的峰值
    /// 检测器——一段真的响了 0.1 秒的声音不会被当成孤立的坏样本丢掉。
    #[test]
    fn silence_gate_lets_a_brief_real_sound_through() {
        let rate = OUTPUT_RATE as usize;
        let mut samples = vec![0.0f32; rate * 3];
        for index in 0..(rate / 10) {
            let phase = 2.0 * std::f32::consts::PI * 300.0 * index as f32 / rate as f32;
            samples[rate + index] = 0.3 * phase.sin();
        }
        assert!(samples.len() >= rate * 3 / 10, "应越过最短长度门");
        assert!(has_voice(&samples), "撞击段会被峰值判定当成有声音");
        assert!(!is_silent(&samples), "0.1 秒真实声响不该被当成静音");

        // 而同样时长里只有一个采样点的尖峰则必须拦下——两者靠占比区分。
        let mut spiked = vec![0.0f32; rate * 3];
        spiked[rate] = 0.5;
        assert!(is_silent(&spiked), "孤立单点尖峰撑不起整段录音");
    }

    // 说明：`capture_diagnostics` / `CaptureProbe` 在 `platform` 模块内，
    // 而 platform 在非 Windows 上是空壳，所以这几条测试只在 Windows 上编译。
    // platform 是 `audio` 的直接子模块，和 tests 是兄弟，所以路径是 `super::platform`。
    #[cfg(windows)]
    mod capture_evidence {
        use super::platform::{
            capture_diagnostics, recoverable_warning, CaptureProbe, PROBE_MIN_FRAMES,
            WARNING_DATA_DISCONTINUITY,
        };
        use std::sync::{Arc, Mutex};

        fn no_fault() -> Arc<Mutex<Option<String>>> {
            Arc::new(Mutex::new(None))
        }

        fn probe(callbacks: u64, frames: u64, error_callbacks: u64) -> CaptureProbe {
            CaptureProbe {
                callbacks,
                frames,
                error_callbacks,
                recoverable: 0,
                recoverable_kind: 0,
            }
        }

        /// 一次可自愈的设备抖动：错误回调计数涨了，但它绝不能被当成致命故障。
        fn with_warning(mut probe: CaptureProbe, times: u64) -> CaptureProbe {
            probe.error_callbacks += times;
            probe.recoverable = times;
            probe.recoverable_kind = WARNING_DATA_DISCONTINUITY;
            probe
        }

        /// 采够了就不是故障：这条保证诊断不会在正常录音上乱弹提示。
        #[test]
        fn a_healthy_capture_yields_no_diagnostic() {
            assert!(capture_diagnostics(&no_fault(), &probe(40, 16_000, 0), 16_000, 1).is_none());
        }

        /// 采样本身就是最长的那根稻草，1 个样本也必须足以满足这个下限。
        /// 这个断言是在守住 PROBE_MIN_FRAMES 的推导：它不能大于 1，
        /// 否则「回调来了、恰好带了 1 帧」会被误判成空缓冲。
        #[test]
        fn min_frames_never_rejects_a_single_frame() {
            assert!(PROBE_MIN_FRAMES <= 1);
        }

        /// 三种故障必须给出三种不同的说法——这正是这次改造的全部意义：
        /// 过去它们在 `stop_audio_session_inner` 里都会被压成同一句「录音太短」。
        #[test]
        fn the_three_failure_shapes_read_differently() {
            // ① 回调压根没触发。
            let silent_device = capture_diagnostics(&no_fault(), &probe(0, 0, 0), 0, 1).unwrap();
            assert!(silent_device.contains("音频回调一次都没有触发"), "{silent_device}");

            // ② 回调装了、但设备直接报错。
            let errored = capture_diagnostics(&no_fault(), &probe(0, 0, 3), 0, 1).unwrap();
            assert!(errored.contains("错误回调触发"), "{errored}");

            // ③ 回调在跑，却一帧都没带。
            let empty_buffers = capture_diagnostics(&no_fault(), &probe(50, 0, 0), 0, 2).unwrap();
            assert!(empty_buffers.contains("空缓冲"), "{empty_buffers}");

            // ④ 真的采到了，只是短——这不是故障，文案里不该出现设备侧的字眼。
            let too_short = capture_diagnostics(&no_fault(), &probe(5, 3_200, 0), 800, 1).unwrap();
            assert!(too_short.contains("只采到"), "{too_short}");
            assert!(!too_short.contains("没有送出"), "{too_short}");

            // 四种说法两两不同，彻底拆开了原本被压成一句话的四类现场。
            let all = [silent_device, errored, empty_buffers, too_short];
            for (i, left) in all.iter().enumerate() {
                for right in &all[i + 1..] {
                    assert_ne!(left, right);
                }
            }
        }

        /// 有真实故障时它优先：那是比计数更具体的证据，且原样保留（不漏字）。
        #[test]
        fn a_recorded_fault_wins_and_is_preserved_verbatim() {
            let fault = Arc::new(Mutex::new(Some("麦克风中断：设备已拔出".to_string())));
            let message = capture_diagnostics(&fault, &probe(12, 4_800, 1), 0, 1).unwrap();
            assert!(message.starts_with("麦克风中断：设备已拔出"), "{message}");
            assert!(message.contains("12 次"), "{message}");
        }

        /// 诊断里绝不能出现音频内容：只允许是计数与固定文案。
        /// 这里用一组极特殊的样本值，确保它们没有任何机会被格式化进消息。
        #[test]
        fn diagnostics_never_leak_sample_data() {
            let message = capture_diagnostics(&no_fault(), &probe(7, 1, 0), 0, 1).unwrap();
            for needle in ["0.123456", "-0.987654", "0x", "samples:"] {
                assert!(!message.contains(needle), "{message}");
            }
        }

        /// 用户当场复现出来的那一次：设备回调只触发 1 次、带来 480 帧，紧接着
        /// 错误回调报了一次可恢复警告。这样的一次抖动绝不能读成「麦克风中断」——
        /// 过去正是那句话把采集循环掐死，用户念的字一个都没采到。
        #[test]
        fn a_recoverable_warning_is_never_worded_as_a_broken_microphone() {
            let readings = with_warning(probe(1, 480, 0), 1);
            let message = capture_diagnostics(&no_fault(), &readings, 0, 2).unwrap();
            assert!(message.contains("数据不连续"), "{message}");
            assert!(message.contains("已继续录音"), "{message}");
            assert!(message.contains("480 帧"), "{message}");
            assert!(!message.contains("麦克风中断"), "{message}");
        }

        /// 两次抖动也只报一次：每出现一次就弹一次通知只会淹没用户。
        #[test]
        fn repeated_warnings_are_counted_once_in_the_wording() {
            let readings = with_warning(probe(9, 4_320, 0), 3);
            let message = capture_diagnostics(&no_fault(), &readings, 0, 2).unwrap();
            assert!(message.contains("3 次"), "{message}");
        }

        /// 采集还在进行时的那句通知必须说清楚「还在录」，
        /// 否则用户会以为已经失败，反而先松了快捷键。
        #[test]
        fn the_live_notice_says_recording_continues() {
            let readings = with_warning(probe(1, 480, 0), 1);
            let live = recoverable_warning(&readings, true).unwrap();
            let final_note = recoverable_warning(&readings, false).unwrap();
            assert!(live.contains("录音已继续"), "{live}");
            assert!(!live.contains("已继续录音"), "{live}");
            assert_ne!(live, final_note);
        }

        /// 没有警告就不该有这句话：正常录音上一次都不该出现。
        #[test]
        fn a_clean_session_has_no_warning_note() {
            assert!(recoverable_warning(&probe(40, 16_000, 0), true).is_none());
            assert!(recoverable_warning(&probe(40, 16_000, 0), false).is_none());
        }
    }
}
