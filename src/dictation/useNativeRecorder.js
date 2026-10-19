import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Desktop recording. Audio bytes remain in the Rust service. */
export function useNativeRecorder({ onDeviceState } = {}) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const sessionRef = useRef(null);
  const generationRef = useRef(0);
  const callbackRef = useRef(onDeviceState);
  callbackRef.current = onDeviceState;

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return undefined;
    let disposed = false;
    const listener = listen("audio-level", ({ payload }) => {
      if (!disposed && payload?.sessionId === sessionRef.current) setLevel(payload.level || 0);
    });
    const errorListener = listen("audio-device-error", ({ payload }) => {
      if (!disposed && payload?.sessionId === sessionRef.current) callbackRef.current?.({ phase: "error", message: payload.message });
    });
    // 设备抖动（WASAPI 的 Xrun）是可自愈的：后端仍会继续采集，这里只提示，
    // 绝不报成 error —— error 一路上会触发「保存并结束」。
    const warningListener = listen("audio-device-warning", ({ payload }) => {
      if (!disposed && payload?.sessionId === sessionRef.current) callbackRef.current?.({ phase: "warning", message: payload.message });
    });
    return () => {
      disposed = true;
      listener.then((off) => off());
      errorListener.then((off) => off());
      warningListener.then((off) => off());
      if (sessionRef.current) invoke("cancel_audio_session", { sessionId: sessionRef.current }).catch(() => {});
    };
  }, []);

  const start = useCallback(async (sessionId, deviceId = "", endpoint = "", model = "", earlyText = false, intent = "", provider = "openai", locale = "zh-CN", hotWords = []) => {
    if (!sessionId) throw new Error("录音会话缺少 ID");
    const generation = ++generationRef.current;
    sessionRef.current = sessionId;
    try {
      await invoke("start_audio_session", { sessionId, deviceId, endpoint, model, earlyText, intent, provider, locale, hotWords });
      if (generation !== generationRef.current) {
        await invoke("cancel_audio_session", { sessionId }).catch(() => {});
        return;
      }
      setRecording(true);
      callbackRef.current?.({ phase: "recording" });
    } catch (error) {
      if (generation === generationRef.current) sessionRef.current = null;
      throw error;
    }
  }, []);

  const stop = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId) return null;
    sessionRef.current = null;
    setLevel(0);
    setRecording(false);
    const info = await invoke("stop_audio_session", { sessionId });
    callbackRef.current?.({ phase: "stopped", message: info.deviceError });
    return { nativeSessionId: sessionId, filename: "dictation.wav", audioMs: info.audioMs, sampleRate: info.sampleRate, sourceSampleRate: info.sourceSampleRate, deviceError: info.deviceError, transcript: info.transcript, transcriptionError: info.transcriptionError, transcriptionStatus: info.transcriptionStatus, asrMs: info.asrMs };
  }, []);

  const abandon = useCallback(({ preserveAudio = false } = {}) => {
    generationRef.current += 1;
    const sessionId = sessionRef.current;
    sessionRef.current = null;
    setRecording(false);
    setLevel(0);
    if (sessionId && !preserveAudio) invoke("cancel_audio_session", { sessionId }).catch(() => {});
    callbackRef.current?.({ phase: "abandoned" });
  }, []);

  return { start, stop, abandon, recording, level };
}
