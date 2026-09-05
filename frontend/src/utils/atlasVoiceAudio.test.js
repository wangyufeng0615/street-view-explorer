import { describe, expect, it } from "vitest";
import {
  floatTo16BitPCM,
  resampleAudio,
  bytesToBase64,
  base64ToFloat32PCM,
} from "./atlasVoiceAudio";

describe("voice audio codec", () => {
  it("clips samples and preserves little-endian PCM through base64", () => {
    const samples = new Float32Array([-2, -1, 0, 0.5, 1, 2]);
    const pcm = floatTo16BitPCM(samples);
    expect([...pcm.slice(0, 6)]).toEqual([0, 128, 0, 128, 0, 0]);
    const decoded = base64ToFloat32PCM(bytesToBase64(pcm));
    expect([...decoded]).toEqual([
      -1,
      -1,
      0,
      16383 / 32768,
      32767 / 32768,
      32767 / 32768,
    ]);
  });
  it("handles chunked payloads beyond the encoder chunk size", () => {
    const bytes = new Uint8Array(100000).map((_, i) => i % 256);
    const encoded = bytesToBase64(bytes);
    expect(atob(encoded).length).toBe(bytes.length);
    expect(atob(encoded).charCodeAt(99999)).toBe(bytes[99999]);
  });
  it("resamples microphone audio and keeps empty input empty", () => {
    const samples = new Float32Array([0, 0.25, 0.5, 0.75]);
    expect([...resampleAudio(samples, 48000, 24000)]).toEqual([0, 0.5]);
    expect([...resampleAudio(new Float32Array([0, 1]), 24000, 48000)]).toEqual([
      0, 0.5, 1, 1,
    ]);
    expect(resampleAudio(samples, 24000, 24000)).toBe(samples);
    expect(resampleAudio(new Float32Array(), 48000, 24000)).toHaveLength(0);
  });
});
