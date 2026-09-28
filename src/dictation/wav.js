// WAV 打包与重采样：纯函数，不依赖浏览器或 React，可直接被 node --test 引入。

export const ASR_SAMPLE_RATE = 16000;

/**
 * 把单声道 Float32 采样打包成 16-bit PCM WAV。
 *
 * 不用 MediaRecorder 的 webm：服务端解析音频时长时不带 EBML 解析器，
 * 收到 webm 会直接 500（"webm duration parsing requires full EBML parser"）。
 * WAV 头部自带时长信息，任何 OpenAI 兼容接口都能直接读。
 */
export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

/**
 * 把任意采样率的重采样到 ASR 约定的 16kHz。
 *
 * 为什么必须有这一步：AudioContext({ sampleRate: 16000 }) 只是向浏览器「请求」16kHz，
 * WebView2 在部分设备上仍会给出硬件原生的 44.1k/48k。若只改 WAV 头里的采样率字段，
 * 音频会以错误速度播放，识别结果会变调、丢字——所以这里按实际采样率真正重采样。
 *
 * 做法是最简单的窗口平均（box filter）：对每个输出样本，平均它覆盖的那一段输入样本。
 * 对语音识别足够，且顺带起到抗混叠作用；不做多相滤波是刻意的取舍，避免在录音路径上引入复杂度。
 */
export function resampleForAsr(samples, sourceRate, targetRate = ASR_SAMPLE_RATE) {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || sourceRate === targetRate) {
    return { samples, sampleRate: sourceRate === targetRate ? targetRate : ASR_SAMPLE_RATE };
  }
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += samples[cursor];
    output[index] = sum / (end - start);
  }
  return { samples: output, sampleRate: targetRate };
}

/** 把多段 Float32 采样首尾拼成一段。 */
export function concatSamples(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

/**
 * 读 WAV 头，回读 rate / 声道数 / 位深 / 数据字节数。
 * 只用于测试与自检，不参与录音路径。
 */
export function readWavHeader(bytes) {
  const view = new DataView(bytes.buffer ? bytes.buffer : bytes, bytes.byteOffset || 0, bytes.byteLength || bytes.length);
  const text = (offset, length) => {
    let output = "";
    for (let index = 0; index < length; index += 1) output += String.fromCharCode(view.getUint8(offset + index));
    return output;
  };
  return {
    riff: text(0, 4),
    wave: text(8, 4),
    format: text(12, 4),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: text(36, 4),
    dataBytes: view.getUint32(40, true),
  };
}

/**
 * 把 WAV Blob 转成 base64。逐字节 String.fromCharCode + btoa，
 * 避免依赖 FileReader / Array.from(...).join("") 这类大数组写法。
 */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

export function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}