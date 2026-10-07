import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

vi.mock("../services/api", () => ({
  fetchGeoBattleImage: vi.fn(),
}));
// The real api module (used in one test) reads the session id from storage.
vi.mock("../utils/session", () => ({
  getOrCreateSessionId: () => "session-1",
}));

import { fetchGeoBattleImage } from "../services/api";
import {
  IMAGE_RETRY_DELAYS_MS,
  SATELLITE_ZOOM_TRANSITION_MS,
  useGeoBattleSatelliteImage,
} from "./useGeoBattleSatelliteImage";

const t = (key) => key;

function roomAt(phase, round = {}) {
  return {
    room_id: "room-1",
    phase,
    round: { index: 1, current_zoom: 14, zoom_steps: 0, ...round },
  };
}

const PLAYING = roomAt("playing");
const ZOOMED_OUT = roomAt("playing", { current_zoom: 13, zoom_steps: 1 });

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useGeoBattleSatelliteImage", () => {
  let requests;
  let revokeObjectURL;
  let originalRevoke;
  let originalCreate;

  beforeEach(() => {
    vi.useFakeTimers();
    requests = [];
    vi.mocked(fetchGeoBattleImage).mockReset();
    vi.mocked(fetchGeoBattleImage).mockImplementation(
      (roomId, version, signal) =>
        new Promise((resolve, reject) => {
          requests.push({ roomId, version, signal, resolve, reject });
        }),
    );
    originalRevoke = URL.revokeObjectURL;
    originalCreate = URL.createObjectURL;
    revokeObjectURL = vi.fn();
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    URL.revokeObjectURL = originalRevoke;
    URL.createObjectURL = originalCreate;
  });

  function setup(initialRoom = PLAYING) {
    const feedback = { playFeedback: vi.fn(), showFeedbackBubble: vi.fn(), t };
    const feedbackRef = { current: feedback };
    const playFeedback = vi.fn();
    const showFeedbackBubble = vi.fn();
    const hook = renderHook(
      ({ room }) =>
        useGeoBattleSatelliteImage({
          room,
          feedbackRef,
          playFeedback,
          showFeedbackBubble,
          t,
        }),
      { initialProps: { room: initialRoom } },
    );
    return { ...hook, feedback, playFeedback, showFeedbackBubble };
  }

  async function resolveRequest(index, url) {
    await act(async () => {
      requests[index].resolve(url);
    });
  }

  it("loads the round image into an object URL built from the response blob", async () => {
    const actual = await vi.importActual("../services/api");
    vi.mocked(fetchGeoBattleImage).mockImplementationOnce(
      actual.fetchGeoBattleImage,
    );
    const blob = new Blob(["png"], { type: "image/png" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    });
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:round-1");

    const { result } = setup();
    expect(result.current.showImageLoading).toBe(true);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/geo/online/rooms/room-1/image?v=playing-1-14-0");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.headers["X-Session-ID"]).toBe("session-1");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(result.current.imageObjectUrl).toBe("blob:round-1");
    expect(result.current.imgLoaded).toBe(true);
    expect(result.current.showImageLoading).toBe(false);
    expect(result.current.imageInteractionPending).toBe(false);
    expect(result.current.zoomTransition).toBeNull();
  });

  it.each(["lobby", "preparing", "countdown"])(
    "does not request the image during %s",
    (phase) => {
      const { result } = setup(roomAt(phase));
      expect(fetchGeoBattleImage).not.toHaveBeenCalled();
      expect(result.current.imageAvailable).toBe(false);
      expect(result.current.showImageLoading).toBe(false);
    },
  );

  it("requests the image once the room reaches playing", async () => {
    const { result, rerender } = setup(roomAt("countdown"));
    rerender({ room: PLAYING });
    expect(fetchGeoBattleImage).toHaveBeenCalledTimes(1);
    expect(requests[0].roomId).toBe("room-1");
    expect(requests[0].version).toBe("playing-1-14-0");
    await resolveRequest(0, "blob:1");
    expect(result.current.imageObjectUrl).toBe("blob:1");
  });

  it("does not refetch when a poll returns the same image state", async () => {
    const { rerender } = setup();
    await resolveRequest(0, "blob:1");
    rerender({ room: { ...PLAYING, server_time: "later" } });
    expect(fetchGeoBattleImage).toHaveBeenCalledTimes(1);
  });

  it("keeps the old image while zooming out, then hands off over ~760ms", async () => {
    const { result, rerender } = setup();
    await resolveRequest(0, "blob:1");

    rerender({ room: ZOOMED_OUT });
    expect(requests).toHaveLength(2);
    expect(requests[1].version).toBe("playing-1-13-1");
    // Old image stays visible and loaded; no spinner, but interaction waits.
    expect(result.current.imageObjectUrl).toBe("blob:1");
    expect(result.current.imgLoaded).toBe(true);
    expect(result.current.showImageLoading).toBe(false);
    expect(result.current.imageInteractionPending).toBe(true);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await resolveRequest(1, "blob:2");
    expect(result.current.imageObjectUrl).toBe("blob:2");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");
    expect(result.current.imageInteractionPending).toBe(false);
    expect(result.current.zoomTransition).toMatchObject({
      toUrl: "blob:2",
      animationDone: false,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SATELLITE_ZOOM_TRANSITION_MS - 1);
    });
    expect(result.current.zoomTransition).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.zoomTransition).toBeNull();
  });

  it("only completes the handoff for the matching request id", async () => {
    const { result, rerender } = setup();
    await resolveRequest(0, "blob:1");
    rerender({ room: ZOOMED_OUT });
    await resolveRequest(1, "blob:2");
    const { requestId } = result.current.zoomTransition;

    act(() => result.current.handleTransitionEnd(requestId - 1));
    expect(result.current.zoomTransition).toMatchObject({
      requestId,
      animationDone: false,
    });

    act(() => result.current.handleTransitionEnd(requestId));
    expect(result.current.zoomTransition).toBeNull();
  });

  it("does not animate when the image changes outside of playing", async () => {
    const { result, rerender } = setup();
    await resolveRequest(0, "blob:1");
    rerender({ room: roomAt("reveal") });
    await resolveRequest(1, "blob:reveal");
    expect(result.current.imageObjectUrl).toBe("blob:reveal");
    expect(result.current.zoomTransition).toBeNull();
  });

  it("skips the handoff animation when reduced motion is preferred", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true }));
    try {
      const { result, rerender } = setup();
      await resolveRequest(0, "blob:1");
      rerender({ room: ZOOMED_OUT });
      await resolveRequest(1, "blob:2");
      expect(result.current.imageObjectUrl).toBe("blob:2");
      expect(result.current.zoomTransition).toBeNull();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("aborts a stale request and discards its late result", async () => {
    const { result, rerender } = setup();
    rerender({ room: ZOOMED_OUT });

    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);

    await resolveRequest(0, "blob:stale");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:stale");
    expect(result.current.imageObjectUrl).toBeNull();

    await resolveRequest(1, "blob:fresh");
    expect(result.current.imageObjectUrl).toBe("blob:fresh");
  });

  it("revokes and clears the image when it stops being available", async () => {
    const { result, rerender } = setup(roomAt("finished"));
    await resolveRequest(0, "blob:1");

    rerender({ room: roomAt("lobby") });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");
    expect(result.current.imageObjectUrl).toBeNull();
    expect(result.current.imgLoaded).toBe(false);
    expect(result.current.zoomTransition).toBeNull();
  });

  it("revokes the current image and aborts pending requests on unmount", async () => {
    const { rerender, unmount } = setup();
    await resolveRequest(0, "blob:1");
    rerender({ room: ZOOMED_OUT });

    unmount();
    expect(requests[1].signal.aborted).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");
  });

  it("retries a failed image request with backoff before succeeding", async () => {
    const { result, feedback } = setup();
    await act(async () => {
      requests[0].reject(new Error("image 429"));
    });
    expect(result.current.imgError).toBe(false);
    expect(result.current.showImageLoading).toBe(true);
    expect(requests).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IMAGE_RETRY_DELAYS_MS[0]);
    });
    expect(requests).toHaveLength(2);
    expect(requests[1].version).toBe(requests[0].version);

    await resolveRequest(1, "blob:retry");
    expect(result.current.imageObjectUrl).toBe("blob:retry");
    expect(result.current.imgError).toBe(false);
    expect(feedback.playFeedback).not.toHaveBeenCalled();
  });

  it("shows error feedback once every retry has failed", async () => {
    const { result, feedback } = setup();
    for (let i = 0; i <= IMAGE_RETRY_DELAYS_MS.length; i += 1) {
      await act(async () => {
        requests[i].reject(new Error("image 409"));
      });
      if (i < IMAGE_RETRY_DELAYS_MS.length) {
        expect(result.current.imgError).toBe(false);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(IMAGE_RETRY_DELAYS_MS[i]);
        });
      }
    }
    expect(requests).toHaveLength(IMAGE_RETRY_DELAYS_MS.length + 1);
    expect(result.current.imgError).toBe(true);
    expect(result.current.showImageLoading).toBe(false);
    expect(result.current.imageInteractionPending).toBe(false);
    expect(feedback.playFeedback).toHaveBeenCalledWith("error");
    expect(feedback.showFeedbackBubble).toHaveBeenCalledWith(
      "geo_online.feedback_image_error",
      "danger",
    );
  });

  it("ignores AbortError rejections", async () => {
    const { result, feedback } = setup();
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    await act(async () => {
      requests[0].reject(abortError);
    });
    expect(result.current.imgError).toBe(false);
    expect(feedback.playFeedback).not.toHaveBeenCalled();
  });

  it("reports <img> load errors through the feedback props", async () => {
    const { result, playFeedback, showFeedbackBubble } = setup();
    await resolveRequest(0, "blob:1");
    act(() => result.current.handleImageError());
    expect(result.current.imgError).toBe(true);
    expect(playFeedback).toHaveBeenCalledWith("error");
    expect(showFeedbackBubble).toHaveBeenCalledWith(
      "geo_online.feedback_image_error",
      "danger",
    );
  });
});
