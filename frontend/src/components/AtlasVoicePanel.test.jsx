import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AtlasVoicePanel, { TOOL_DEFINITIONS } from "./AtlasVoicePanel";
import useStore from "../store/useStore";
import { MIC_AUDIO_CONSTRAINTS } from "../utils/atlasVoiceRuntime";
import { getRealtimeVoiceConfig } from "../services/api";

const apiMocks = vi.hoisted(() => ({
  createRealtimeClientSecret: vi.fn(),
  deleteExplorationPreference: vi.fn(),
  getRealtimeVoiceConfig: vi.fn(),
  getStreetViewFrameDataURL: vi.fn(),
  searchLocation: vi.fn(),
  setExplorationPreference: vi.fn(),
  synthesizeDoubaoTTSStream: vi.fn(),
}));

vi.mock("../services/api", () => apiMocks);

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    i18n: {
      language: "zh",
      resolvedLanguage: "zh",
    },
  }),
}));

class MockWebSocket {
  static OPEN = 1;

  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = new Map();
    MockWebSocket.instances.push(this);
    window.setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit("open", {});
    }, 0);
  }

  addEventListener(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.readyState = 3;
    this.emit("close", {});
  }

  emit(eventName, event) {
    for (const callback of this.listeners.get(eventName) || []) {
      callback(event);
    }
  }

  emitRealtime(event) {
    this.emit("message", { data: JSON.stringify(event) });
  }
}

function mockAudioNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

class MockAudioContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.state = "running";
    this.destination = {};
  }

  resume = vi.fn().mockResolvedValue();

  close = vi.fn().mockResolvedValue();

  createMediaStreamSource = vi.fn(() => mockAudioNode());

  createScriptProcessor = vi.fn(() => ({
    ...mockAudioNode(),
    onaudioprocess: null,
  }));

  createGain = vi.fn(() => ({
    ...mockAudioNode(),
    gain: { value: 1 },
  }));

  createBuffer = vi.fn((_channels, length, sampleRate) => ({
    duration: length / sampleRate,
    copyToChannel: vi.fn(),
  }));

  createBufferSource = vi.fn(() => ({
    ...mockAudioNode(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  }));
}

function resetStore() {
  useStore.setState({
    location: {
      formatted_address: "Cromwell, New Zealand",
      latitude: -45.0384,
      longitude: 169.2001,
      pano_id: "pano-cromwell",
    },
    currentLocationRef: {
      formatted_address: "Cromwell, New Zealand",
      latitude: -45.0384,
      longitude: 169.2001,
      pano_id: "pano-cromwell",
    },
    description: "A road outside town.",
    heading: 10,
    streetViewView: null,
    toastMessage: "",
    showToast: false,
  });
}

describe("AtlasVoicePanel", () => {
  let getUserMedia;

  beforeEach(() => {
    MockWebSocket.instances = [];
    window.WebSocket = MockWebSocket;
    global.WebSocket = MockWebSocket;
    window.AudioContext = MockAudioContext;
    window.webkitAudioContext = MockAudioContext;
    getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    getRealtimeVoiceConfig.mockResolvedValue({
      success: true,
      data: {
        provider: "doubao",
        doubao_configured: true,
        doubao_sample_rate: 24000,
      },
    });
    apiMocks.getStreetViewFrameDataURL.mockResolvedValue({
      success: true,
      data: "data:image/jpeg;base64,c2NlbmU=",
      error: null,
    });
    resetStore();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function startPanel() {
    render(<AtlasVoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText("可以说话了")).toBeInTheDocument(),
    );
    return MockWebSocket.instances[0];
  }

  it("exposes one unambiguous navigation tool", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "navigate",
      "look_direction",
      "read_current_place",
    ]);
    expect(TOOL_DEFINITIONS[0].parameters.properties.mode.enum).toEqual([
      "random",
      "theme",
      "place",
      "coordinates",
      "nearby",
    ]);
  });

  it("starts microphone capture with echo cancellation controls", async () => {
    await startPanel();

    expect(getUserMedia).toHaveBeenCalledWith(MIC_AUDIO_CONSTRAINTS);
  });

  it("adds the current Street View frame to Realtime without triggering speech", async () => {
    const socket = await startPanel();

    await waitFor(() =>
      expect(apiMocks.getStreetViewFrameDataURL).toHaveBeenCalled(),
    );
    const sceneEvent = socket.sent.find(
      (event) =>
        event.type === "conversation.item.create" &&
        event.item?.content?.some((part) => part.type === "input_image"),
    );

    expect(sceneEvent?.item?.content?.[0]).toMatchObject({
      type: "input_image",
      image_url: "data:image/jpeg;base64,c2NlbmU=",
      detail: "high",
    });
    expect(apiMocks.getStreetViewFrameDataURL).toHaveBeenCalledWith(
      "pano-cromwell",
      expect.objectContaining({ panoId: "pano-cromwell" }),
      expect.any(AbortSignal),
    );
    expect(socket.sent.some((event) => event.type === "response.create")).toBe(
      false,
    );
  });

  it("deletes an older scene instead of leaving stale vision after a new frame fails", async () => {
    apiMocks.getStreetViewFrameDataURL
      .mockResolvedValueOnce({
        success: true,
        data: "data:image/jpeg;base64,b2xkLXNjZW5l",
        error: null,
      })
      .mockResolvedValueOnce({
        success: false,
        data: null,
        error: "frame unavailable",
      });
    const socket = await startPanel();

    await waitFor(() =>
      expect(
        socket.sent.some(
          (event) =>
            event.type === "conversation.item.create" &&
            event.item?.content?.some((part) => part.type === "input_image"),
        ),
      ).toBe(true),
    );

    await act(async () => {
      useStore.getState().setStreetViewView({
        panoId: "pano-next",
        latitude: -45.038,
        longitude: 169.201,
        heading: 120,
        pitch: 0,
        fov: 90,
        source: "user",
      });
    });

    await waitFor(
      () => expect(apiMocks.getStreetViewFrameDataURL).toHaveBeenCalledTimes(2),
      { timeout: 2500 },
    );
    expect(
      socket.sent.some(
        (event) =>
          event.type === "conversation.item.delete" &&
          String(event.item_id || "").startsWith("atlas_scene_"),
      ),
    ).toBe(true);
  });

  it("keeps thinking after a tool result instead of pretending it is ready", async () => {
    const socket = await startPanel();

    await act(async () => {
      socket.emitRealtime({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: "call-read-place",
          name: "read_current_place",
          arguments: "{}",
        },
      });
    });

    await waitFor(() => expect(screen.getByText("正在想")).toBeInTheDocument());
    expect(socket.sent.some((event) => event.type === "response.create")).toBe(
      true,
    );
  });

  it("blocks a second navigation attempt in the same user turn", async () => {
    apiMocks.searchLocation.mockResolvedValue({
      success: false,
      data: null,
      place: null,
      error: "not found",
    });
    const socket = await startPanel();

    await act(async () => {
      socket.emitRealtime({ type: "input_audio_buffer.speech_started" });
      socket.emitRealtime({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: "call-navigate-1",
          name: "navigate",
          arguments: JSON.stringify({
            mode: "place",
            query: "missing landmark",
          }),
        },
      });
    });
    await waitFor(() =>
      expect(apiMocks.searchLocation).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      socket.emitRealtime({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: "call-navigate-2",
          name: "navigate",
          arguments: JSON.stringify({ mode: "theme", query: "landmarks" }),
        },
      });
    });

    await waitFor(() => {
      const outputEvent = socket.sent.find(
        (event) =>
          event.type === "conversation.item.create" &&
          event.item?.type === "function_call_output" &&
          event.item?.call_id === "call-navigate-2",
      );
      expect(JSON.parse(outputEvent?.item?.output || "{}")).toMatchObject({
        success: false,
        terminal: true,
        retry_allowed: false,
      });
    });
    expect(apiMocks.searchLocation).toHaveBeenCalledTimes(1);
    expect(apiMocks.setExplorationPreference).not.toHaveBeenCalled();
  });

  it("does not speak pre-tool action text from the same response", async () => {
    const socket = await startPanel();

    await act(async () => {
      socket.emitRealtime({
        type: "response.done",
        response: {
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "走，咱们再挪一段更往乡下走的路。",
                },
              ],
            },
            {
              type: "function_call",
              call_id: "call-read-place",
              name: "read_current_place",
              arguments: "{}",
            },
          ],
        },
      });
    });

    await waitFor(() =>
      expect(
        socket.sent.some((event) => event.type === "response.create"),
      ).toBe(true),
    );
    expect(apiMocks.synthesizeDoubaoTTSStream).not.toHaveBeenCalled();
    expect(
      screen.queryByText("走，咱们再挪一段更往乡下走的路。"),
    ).not.toBeInTheDocument();
  });

  it("does not show assistant text before knowing whether a tool will run", async () => {
    const socket = await startPanel();

    await act(async () => {
      socket.emitRealtime({
        type: "response.output_item.done",
        item: {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "好的，我带你过去。",
            },
          ],
        },
      });
    });

    expect(screen.queryByText("好的，我带你过去。")).not.toBeInTheDocument();
  });
});
