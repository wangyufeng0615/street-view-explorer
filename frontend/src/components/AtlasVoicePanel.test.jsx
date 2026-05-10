import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AtlasVoicePanel from "./AtlasVoicePanel";
import useStore from "../store/useStore";
import { MIC_AUDIO_CONSTRAINTS } from "../utils/atlasVoiceRuntime";
import { getRealtimeVoiceConfig } from "../services/api";

const apiMocks = vi.hoisted(() => ({
  createRealtimeClientSecret: vi.fn(),
  deleteExplorationPreference: vi.fn(),
  getRealtimeVoiceConfig: vi.fn(),
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
    await waitFor(() => expect(screen.getByText("可以说话了")).toBeInTheDocument());
    return MockWebSocket.instances[0];
  }

  it("starts microphone capture with echo cancellation controls", async () => {
    await startPanel();

    expect(getUserMedia).toHaveBeenCalledWith(MIC_AUDIO_CONSTRAINTS);
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
    expect(socket.sent.some((event) => event.type === "response.create")).toBe(true);
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
      expect(socket.sent.some((event) => event.type === "response.create")).toBe(true),
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
