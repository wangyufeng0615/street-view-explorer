import { describe, expect, it, vi } from "vitest";
import {
  doubaoErrorMessage,
  playDoubaoSpeechResponse,
} from "./atlasVoiceDoubaoStream";

const copy = {
  ttsError: "Doubao speech synthesis failed",
  ttsMissingCredentials: "missing credentials hint",
};

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return { ok: true, body };
}

describe("doubaoErrorMessage", () => {
  it("prefers the JSON error field and falls back to the raw body", () => {
    expect(doubaoErrorMessage('{"error":"upstream 502"}', copy)).toBe(
      "upstream 502",
    );
    expect(doubaoErrorMessage('{"message":"slow down"}', copy)).toBe(
      "slow down",
    );
    expect(doubaoErrorMessage("gateway timeout", copy)).toBe("gateway timeout");
    expect(doubaoErrorMessage("", copy)).toBe(copy.ttsError);
  });

  it("maps any missing-credential failure to the localized hint", () => {
    expect(
      doubaoErrorMessage(
        '{"code":"doubao_tts_missing_credentials","error":"x"}',
        copy,
      ),
    ).toBe(copy.ttsMissingCredentials);
    expect(doubaoErrorMessage("invalid Credentials supplied", copy)).toBe(
      copy.ttsMissingCredentials,
    );
  });
});

describe("playDoubaoSpeechResponse", () => {
  it("reassembles NDJSON lines split across chunks and forwards audio deltas", async () => {
    const onAudioDelta = vi.fn();
    await playDoubaoSpeechResponse(
      streamResponse([
        '{"type":"audio_delta","delta":"AA","sample_rate":24000}\n{"type":"au',
        'dio_delta","delta":"BB"}\n\nnot json\n{"type":"meta"}\n',
        '{"type":"audio_delta","delta":"CC"}',
      ]),
      {
        signal: new AbortController().signal,
        isCurrent: () => true,
        onAudioDelta,
        copy,
      },
    );

    expect(onAudioDelta.mock.calls.map(([event]) => event.delta)).toEqual([
      "AA",
      "BB",
      "CC",
    ]);
    expect(onAudioDelta.mock.calls[0][0].sample_rate).toBe(24000);
  });

  it("drops audio once the speech generation is no longer current", async () => {
    const onAudioDelta = vi.fn();
    let current = true;
    await playDoubaoSpeechResponse(
      streamResponse([
        '{"type":"audio_delta","delta":"AA"}\n',
        '{"type":"audio_delta","delta":"BB"}\n',
      ]),
      {
        signal: new AbortController().signal,
        isCurrent: () => current,
        onAudioDelta: (event) => {
          onAudioDelta(event);
          current = false;
        },
        copy,
      },
    );
    expect(onAudioDelta).toHaveBeenCalledTimes(1);
  });

  it("throws on upstream error lines, failed responses and missing bodies", async () => {
    const options = {
      signal: new AbortController().signal,
      isCurrent: () => true,
      onAudioDelta: vi.fn(),
      copy,
    };
    await expect(
      playDoubaoSpeechResponse(
        streamResponse(['{"type":"error","error":"voice busy"}\n']),
        options,
      ),
    ).rejects.toThrow("voice busy");
    await expect(
      playDoubaoSpeechResponse(
        { ok: false, text: async () => '{"error":"bad text"}' },
        options,
      ),
    ).rejects.toThrow("bad text");
    await expect(
      playDoubaoSpeechResponse({ ok: true, body: null }, options),
    ).rejects.toThrow(copy.ttsError);
  });
});
