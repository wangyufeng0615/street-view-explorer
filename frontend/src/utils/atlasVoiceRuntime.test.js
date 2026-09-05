import { describe, expect, it } from "vitest";
import {
  MIC_AUDIO_CONSTRAINTS,
  buildRealtimeSceneContextEvent,
  buildRealtimeTurnDetection,
  buildStreetViewSceneSignature,
  buildVoiceContextSignature,
  nextDoubaoSpeechQueue,
  realtimeAudioMaxBufferedBytes,
  resolveStreetViewScene,
  shouldDeferVoiceSessionUpdate,
  shouldDropRealtimeAudioFrame,
  shouldIgnoreAssistantEcho,
} from "./atlasVoiceRuntime";

describe("atlasVoiceRuntime", () => {
  it("requests browser echo controls for voice input", () => {
    expect(MIC_AUDIO_CONSTRAINTS).toEqual({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });

  it("defaults Realtime VAD to a more responsive semantic setting", () => {
    expect(buildRealtimeTurnDetection()).toEqual({
      type: "semantic_vad",
      eagerness: "high",
      create_response: true,
      interrupt_response: true,
    });
  });

  it("bounds realtime audio backpressure settings", () => {
    expect(realtimeAudioMaxBufferedBytes()).toBe(128 * 1024);
    expect(
      realtimeAudioMaxBufferedBytes({
        VITE_REALTIME_AUDIO_MAX_BUFFERED_BYTES: "4096",
      }),
    ).toBe(16 * 1024);
    expect(
      shouldDropRealtimeAudioFrame({
        bufferedAmount: 200_000,
        maxBufferedBytes: 128 * 1024,
      }),
    ).toBe(true);
    expect(
      shouldDropRealtimeAudioFrame({
        bufferedAmount: 32_000,
        maxBufferedBytes: 128 * 1024,
      }),
    ).toBe(false);
  });

  it("can build a bounded server VAD override from environment values", () => {
    expect(
      buildRealtimeTurnDetection({
        VITE_REALTIME_VAD_TYPE: "server_vad",
        VITE_REALTIME_VAD_THRESHOLD: "1.5",
        VITE_REALTIME_VAD_PREFIX_PADDING_MS: "180",
        VITE_REALTIME_VAD_SILENCE_DURATION_MS: "280",
      }),
    ).toEqual({
      type: "server_vad",
      threshold: 1,
      prefix_padding_ms: 180,
      silence_duration_ms: 280,
      create_response: true,
      interrupt_response: true,
    });
  });

  it("only changes context signature when relevant voice context changes", () => {
    const base = buildVoiceContextSignature({
      location: {
        pano_id: "pano-1",
        latitude: 45.123456,
        longitude: 7.654321,
      },
      heading: 12.4,
      description: "quiet road",
    });

    expect(
      buildVoiceContextSignature({
        location: {
          pano_id: "pano-1",
          latitude: 45.123459,
          longitude: 7.654324,
        },
        heading: 17.49,
        description: "quiet road",
      }),
    ).toBe(base);

    expect(
      buildVoiceContextSignature({
        location: {
          pano_id: "pano-1",
          latitude: 45.123459,
          longitude: 7.654324,
        },
        heading: 24,
        description: "quiet road",
      }),
    ).not.toBe(base);

    expect(
      buildVoiceContextSignature({
        location: {
          pano_id: "pano-2",
          latitude: 45.123456,
          longitude: 7.654321,
        },
        heading: 12.4,
        description: "quiet road",
      }),
    ).not.toBe(base);
  });

  it("prefers the actual panorama view and builds a stable scene image event", () => {
    const scene = resolveStreetViewScene({
      location: { pano_id: "stored-pano" },
      streetViewView: {
        panoId: "actual-pano",
        heading: 91.4,
        pitch: -4.6,
        fov: 72,
        source: "user",
      },
      heading: 10,
    });

    expect(scene).toMatchObject({
      panoId: "actual-pano",
      pitch: -4.6,
      fov: 72,
      source: "user",
    });
    expect(scene.heading).toBeCloseTo(91.4, 6);
    expect(buildStreetViewSceneSignature(scene)).toBe("actual-pano:90:-5:72");
    expect(
      buildRealtimeSceneContextEvent({
        itemId: "scene-1",
        imageDataUrl: "data:image/jpeg;base64,abc",
        scene,
      }),
    ).toMatchObject({
      type: "conversation.item.create",
      item: {
        id: "scene-1",
        role: "user",
        content: [
          { type: "input_image", image_url: "data:image/jpeg;base64,abc" },
          { type: "input_text" },
        ],
      },
    });
  });

  it("defers session updates only when context is pending and speech/tooling is active", () => {
    expect(
      shouldDeferVoiceSessionUpdate({
        status: "speaking",
        hasActiveSpeech: true,
        contextSignature: "new",
        sentContextSignature: "old",
      }),
    ).toBe(true);

    expect(
      shouldDeferVoiceSessionUpdate({
        status: "connected",
        hasActiveSpeech: false,
        contextSignature: "same",
        sentContextSignature: "same",
      }),
    ).toBe(false);

    expect(
      shouldDeferVoiceSessionUpdate({
        status: "connected",
        hasActiveSpeech: false,
        contextSignature: "new",
        sentContextSignature: "old",
      }),
    ).toBe(false);
  });

  it("guards against speaker-to-mic echo while assistant audio is active", () => {
    expect(
      shouldIgnoreAssistantEcho({
        provider: "doubao",
        hasActiveSpeech: true,
        assistantSpeechStartedAtMs: 1000,
        nowMs: 1300,
      }),
    ).toBe(true);

    expect(
      shouldIgnoreAssistantEcho({
        provider: "doubao",
        hasActiveSpeech: true,
        assistantSpeechStartedAtMs: 1000,
        nowMs: 1900,
      }),
    ).toBe(true);
  });

  it("keeps a short echo tail after assistant playback ends", () => {
    expect(
      shouldIgnoreAssistantEcho({
        provider: "doubao",
        hasActiveSpeech: false,
        echoTailActive: true,
      }),
    ).toBe(true);

    expect(
      shouldIgnoreAssistantEcho({
        provider: "doubao",
        hasActiveSpeech: false,
        echoTailActive: false,
        assistantSpeechStartedAtMs: 1000,
        nowMs: 1900,
      }),
    ).toBe(false);
  });

  it("keeps current speech but replaces stale queued Doubao replies", () => {
    expect(
      nextDoubaoSpeechQueue([{ id: 1, text: "old pending reply" }], {
        id: 2,
        text: "new reply",
      }),
    ).toEqual([{ id: 2, text: "new reply" }]);
  });
});
