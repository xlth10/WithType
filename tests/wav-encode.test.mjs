// WAV 打包与重采样测试。
//
// 这条路径上的错误不会报错，只会让识别结果变调、丢字或者让服务端直接 500，
// 所以头部字段、时长和重采样长度都要按实际字节逐个钉死。
// 测试数据全部是合成采样，不涉及任何真实密钥或真实音频。

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASR_SAMPLE_RATE,
  blobToBase64,
  bytesToBase64,
  concatSamples,
  encodeWav,
  readWavHeader,
  resampleForAsr,
} from "../src/dictation/wav.js";

async function headerOf(blob) {
  return readWavHeader(new Uint8Array(await blob.arrayBuffer()));
}

test("encodeWav 写出的 RIFF 头字段全部正确", async () => {
  const blob = encodeWav(new Float32Array(16000), 16000);
  assert.equal(blob.type, "audio/wav");
  assert.equal(blob.size, 32044, "44 字节头 + 16000 个 16-bit 样本");
  assert.deepEqual(await headerOf(blob), {
    riff: "RIFF",
    wave: "WAVE",
    format: "fmt ",
    audioFormat: 1,
    channels: 1,
    sampleRate: 16000,
    byteRate: 32000,
    blockAlign: 2,
    bitsPerSample: 16,
    data: "data",
    dataBytes: 32000,
  });
});

test("RIFF 长度与字节率随采样数一致", async () => {
  const blob = encodeWav(new Float32Array(8000), 16000);
  assert.equal(blob.size, 16044);
  const header = await headerOf(blob);
  assert.equal(header.dataBytes, 16000);
  assert.equal(header.byteRate, header.sampleRate * header.blockAlign, "byteRate = sampleRate × blockAlign");
  assert.equal(header.blockAlign, (header.channels * header.bitsPerSample) / 8);
});

test("时长等于样本数除以采样率", async () => {
  // 服务端按头部算时长，样本数与头里的采样率必须自洽。
  for (const sampleRate of [8000, 16000, 48000]) {
    const blob = encodeWav(new Float32Array(sampleRate), sampleRate);
    const header = await headerOf(blob);
    assert.equal(header.dataBytes / (header.sampleRate * header.blockAlign), 1);
  }
});

test("削波不溢出，满量程映射到 16-bit 边界", async () => {
  const blob = encodeWav(new Float32Array([2, -2, 0]), 8000);
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(view.getInt16(44, true), 32767);
  assert.equal(view.getInt16(46, true), -32768);
  assert.equal(view.getInt16(48, true), 0);
});

test("空采样只产出头部", async () => {
  const blob = encodeWav(new Float32Array(0), 16000);
  assert.equal(blob.size, 44);
  assert.equal((await headerOf(blob)).dataBytes, 0);
});

test("resampleForAsr 把 48kHz 降到 16kHz", () => {
  const input = new Float32Array(16000);
  const { samples, sampleRate } = resampleForAsr(input, 48000);
  assert.equal(sampleRate, ASR_SAMPLE_RATE);
  assert.equal(samples.length, 5333);
  assert.notEqual(samples, input, "必须产出新数组，不能就地当 16kHz 用");
});

test("resampleForAsr 在 44.1kHz 上按比例缩短", () => {
  const { samples, sampleRate } = resampleForAsr(new Float32Array(44100), 44100);
  assert.equal(sampleRate, ASR_SAMPLE_RATE);
  assert.equal(samples.length, 16000);
});

test("resampleForAsr 采样率相同时原样返回同一份采样", () => {
  const input = new Float32Array(16000);
  const result = resampleForAsr(input, 16000);
  assert.equal(result.sampleRate, 16000);
  assert.equal(result.samples, input, "已知行为：同采样率走 identity，不做拷贝");
});

test("resampleForAsr 对非法采样率不报错，回落 16kHz", () => {
  const input = new Float32Array(100);
  for (const sourceRate of [0, -1, Number.NaN]) {
    const result = resampleForAsr(input, sourceRate);
    assert.equal(result.samples, input);
    assert.equal(result.sampleRate, ASR_SAMPLE_RATE);
  }
});

test("resampleForAsr 用窗口平均，不产生超出输入的振幅", () => {
  const input = new Float32Array(48).fill(0.5);
  const { samples } = resampleForAsr(input, 48000);
  for (const value of samples) assert.ok(Math.abs(value - 0.5) < 1e-6);
});

test("concatSamples 按顺序拼接", () => {
  const joined = concatSamples([new Float32Array([1]), new Float32Array([2, 3])]);
  assert.deepEqual(Array.from(joined), [1, 2, 3]);
  assert.equal(concatSamples([]).length, 0);
});

test("bytesToBase64 与 blobToBase64 结果一致", async () => {
  const blob = encodeWav(new Float32Array(16000), 16000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const fromBlob = await blobToBase64(blob);
  assert.equal(fromBlob, bytesToBase64(bytes));
  assert.equal(fromBlob.length, 42728);
  assert.ok(fromBlob.startsWith("UklGRiR9AABX"), "开头是 RIFF 头对应的 base64");
});

test("base64 编码跨过分块边界也不出错", async () => {
  // 0x8000 是内部逐段编码的步长，跨过它的长度最容易暴露边界 bug。
  const bytes = new Uint8Array(0x8000 + 7).fill(65);
  const encoded = bytesToBase64(bytes);
  assert.equal(Buffer.from(encoded, "base64").length, bytes.length);
  assert.equal(Buffer.from(encoded, "base64")[0x8000 + 6], 65);
});