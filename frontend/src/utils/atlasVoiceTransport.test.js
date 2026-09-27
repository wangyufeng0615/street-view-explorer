import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeRealtimeTransport,
  getMicrophoneStream,
} from "./atlasVoiceTransport";
import { MIC_AUDIO_CONSTRAINTS } from "./atlasVoiceRuntime";

vi.mock("../services/api", () => ({ createRealtimeClientSecret: vi.fn() }));

describe("atlas voice transport", () => {
  afterEach(() => {
    delete navigator.mediaDevices;
  });

  it("requests the echo-cancelled mic and localizes any failure", async () => {
    const stream = { getTracks: () => [] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    await expect(getMicrophoneStream("no mic")).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith(MIC_AUDIO_CONSTRAINTS);

    getUserMedia.mockRejectedValue(new DOMException("denied"));
    await expect(getMicrophoneStream("no mic")).rejects.toThrow("no mic");

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    await expect(getMicrophoneStream("no mic")).rejects.toThrow("no mic");
  });

  it("closes every transport piece and clears the refs", () => {
    const senderTrack = { stop: vi.fn() };
    const localTrack = { stop: vi.fn() };
    const remoteAudio = { srcObject: {} };
    const refs = {
      channelRef: { current: { close: vi.fn() } },
      socketRef: { current: { close: vi.fn() } },
      peerRef: {
        current: {
          getSenders: () => [{ track: senderTrack }, { track: null }],
          close: vi.fn(),
        },
      },
      localStreamRef: { current: { getTracks: () => [localTrack] } },
      remoteAudioRef: { current: remoteAudio },
    };
    const { channelRef, socketRef, peerRef } = refs;
    const channel = channelRef.current;
    const socket = socketRef.current;
    const peer = peerRef.current;

    closeRealtimeTransport(refs);

    expect(channel.close).toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalled();
    expect(senderTrack.stop).toHaveBeenCalled();
    expect(localTrack.stop).toHaveBeenCalled();
    expect(remoteAudio.srcObject).toBeNull();
    Object.values(refs).forEach((ref) => expect(ref.current).toBeNull());

    // Idempotent once everything is released.
    expect(() => closeRealtimeTransport(refs)).not.toThrow();
  });
});
