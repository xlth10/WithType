// 音频采集、WAV 编码与电平表。**不做网络请求，也不做任何文字处理**：
// 它只负责把一段录音变成 { audioBase64, filename, audioMs, sampleRate }，
// 剩下的路由与上屏由 pipeline 决定。

import { useCallback, useEffect, useRef, useState } from "react";
import { acquireMicrophone } from "./acquireMicrophone.js";
import { ASR_SAMPLE_RATE, blobToBase64, concatSamples, encodeWav, resampleForAsr } from "./wav.js";

export const RECORD_FILENAME = "dictation.wav";
/** 短于这个时长的录音直接判为误触。 */
const MIN_AUDIO_MS = 300;

/**
 * @param {(event: {phase: string, message?: string}) => void} onDeviceState
 *   麦克风设备的起停事件。采集层如实上报，是否显示成 HUD 状态由上层决定。
 */
export function useWavRecorder({ onDeviceState } = {}) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);

  const generationRef = useRef(0);
  const contextRef = useRef(null);
  const nodeRef = useRef(null);
  const streamRef = useRef(null);
  const samplesRef = useRef([]);
  const animationRef = useRef(null);
  const analyserRef = useRef(null);
  const startedRef = useRef(0);
  const stateCallbackRef = useRef(onDeviceState);
  stateCallbackRef.current = onDeviceState;

  const notifyDevice = (phase, message) => {
    if (stateCallbackRef.current) stateCallbackRef.current({ phase, message });
  };

  const stopMeter = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    analyserRef.current = null;
    setLevel(0);
  }, []);

  const teardown = useCallback(() => {
    if (nodeRef.current) {
      nodeRef.current.onaudioprocess = null;
      nodeRef.current.disconnect();
      nodeRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    samplesRef.current = [];
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
    // 窗口关闭或组件卸载时释放麦克风，避免设备灯一直亮着。
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (nodeRef.current) {
      nodeRef.current.onaudioprocess = null;
      nodeRef.current.disconnect();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    contextRef.current?.close().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (contextRef.current) return;
    const generation = ++generationRef.current;
    const resources = await acquireMicrophone({
      getUserMedia: (options) => navigator.mediaDevices.getUserMedia(options),
      createContext: () => new AudioContext({ sampleRate: ASR_SAMPLE_RATE }),
      isCurrent: () => generation === generationRef.current,
    });
    if (!resources) return;
    const { stream, context } = resources;
    streamRef.current = stream;
    contextRef.current = context;
    try {
    const source = context.createMediaStreamSource(stream);
    // 这一版仍然是 ScriptProcessor 路径，迁移到 AudioWorklet 是独立的一次改动：
    // 两者都会影响采集时序，一次只动一类风险。
    const node = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0; // 只为让音频图保持运行，不把麦克风回放到扬声器
    samplesRef.current = [];
    startedRef.current = Date.now();
    node.onaudioprocess = (event) => {
      samplesRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(node);
    node.connect(mute);
    mute.connect(context.destination);
    contextRef.current = context;
    nodeRef.current = node;
    streamRef.current = stream;

    // 电平表复用同一条音频图：另开 analyser 接在 source 上，避免为取音量再建一路 AudioContext。
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    analyserRef.current = analyser;
    const samples = new Float32Array(analyser.fftSize);
    const measure = () => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      setLevel(Math.min(1, rms * 6.5));
      animationRef.current = requestAnimationFrame(measure);
    };
    measure();

    setRecording(true);
    notifyDevice("recording");
    } catch (error) {
      teardown();
      stopMeter();
      throw error;
    }
  }, [teardown, stopMeter]);

  /**
   * 结束采集并返回这一条录音。
   *
   * 采样率以 AudioContext 实际给出的为准（context.sampleRate），
   * 不是以我们请求的 16000 为准；不等于 16000 时在这里真正重采样，
   * 而不是只把 WAV 头里的字段改成 16000。
   */
  const stop = useCallback(async () => {
    if (!nodeRef.current) return null;
    const sourceRate = contextRef.current?.sampleRate || ASR_SAMPLE_RATE;
    const chunks = samplesRef.current;
    const audioMs = Math.max(0, Date.now() - startedRef.current);
    teardown();
    stopMeter();
    setRecording(false);
    notifyDevice("stopped");

    const raw = concatSamples(chunks);
    if (audioMs < MIN_AUDIO_MS || raw.length === 0) {
      throw new Error("录音太短，请多说几个字后再按快捷键结束");
    }
    const { samples, sampleRate } = resampleForAsr(raw, sourceRate, ASR_SAMPLE_RATE);
    const audioBase64 = await blobToBase64(encodeWav(samples, sampleRate));
    return { audioBase64, filename: RECORD_FILENAME, audioMs, sampleRate, sourceSampleRate: sourceRate };
  }, [stopMeter, teardown]);

  /** 无条件丢弃当前采集：不返回音频，不再触发任何回调。 */
  const abandon = useCallback(() => {
    generationRef.current += 1;
    teardown();
    stopMeter();
    setRecording(false);
    notifyDevice("abandoned");
  }, [stopMeter, teardown]);

  return { start, stop, abandon, recording, level };
}