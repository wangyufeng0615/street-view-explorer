import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StreetView, { resetInteractionTipForTests } from "./StreetView";
import { loadGoogleMapsWhenVisible } from "../utils/googleMaps";

const translation = vi.hoisted(() => ({
  t: (key) => key,
}));

vi.mock("../utils/googleMaps", () => ({
  loadGoogleMapsWhenVisible: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translation.t }),
}));

class MockStreetViewPanorama {
  constructor(_element, options) {
    const node = document.createElement("div");
    node.dataset.testid = "mock-panorama";
    _element.appendChild(node);
    this.options = options;
    this.setVisible = vi.fn();
    this.pov = { ...options.pov };
    this.pano = options.pano || "";
    this.position = options.position || null;
    this.zoom = options.zoom;
    this.listeners = new Map();
    this.setPovCalls = 0;
    this.status = "OK";
    this.setPano = vi.fn((pano) => {
      this.pano = pano;
      // 和 Maps 的 MVCObject 一样，设置属性会同步触发 *_changed
      this.emit("pano_changed");
    });
    this.setPosition = vi.fn((position) => {
      this.position = position;
    });
    this.setZoom = vi.fn((zoom) => {
      this.zoom = zoom;
    });
    MockStreetViewPanorama.instances.push(this);
  }

  addListener(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);

    return {
      remove: () => this.listeners.get(eventName)?.delete(callback),
    };
  }

  getPov() {
    return this.pov;
  }

  setPov(nextPov) {
    this.setPovCalls += 1;
    this.pov = { ...this.pov, ...nextPov };
    this.emit("pov_changed");
  }

  getPano() {
    return this.pano;
  }

  getZoom() {
    return this.zoom;
  }

  getStatus() {
    return this.status;
  }

  emit(eventName) {
    for (const callback of this.listeners.get(eventName) || []) {
      callback();
    }
  }
}

MockStreetViewPanorama.instances = [];

class MockStreetViewService {
  async getPanorama() {
    return { data: { location: { pano: "official-near" } } };
  }
}

function mockMaps() {
  return {
    StreetViewPanorama: MockStreetViewPanorama,
    StreetViewService: MockStreetViewService,
    StreetViewSource: { GOOGLE: "google" },
    StreetViewPreference: { NEAREST: "nearest" },
    ControlPosition: { RIGHT_CENTER: 5 },
  };
}

function setDocumentVisibility(value) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
}

function setDocumentFocus(isFocused) {
  Object.defineProperty(document, "hasFocus", {
    configurable: true,
    value: () => isFocused,
  });
}

async function advanceTimers(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("StreetView auto-rotation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockStreetViewPanorama.instances = [];
    resetInteractionTipForTests();
    setDocumentVisibility("visible");
    setDocumentFocus(true);
    loadGoogleMapsWhenVisible.mockResolvedValue(mockMaps());
  });

  afterEach(() => {
    cleanup();
    translation.t = (key) => key;
    vi.useRealTimers();
    vi.clearAllMocks();
    setDocumentVisibility("visible");
    setDocumentFocus(true);
  });

  it("keeps automatic POV updates smooth without returning to a 60fps loop", async () => {
    const onPovChanged = vi.fn();
    render(
      <StreetView
        latitude={9.23656}
        longitude={4.8982}
        onPovChanged={onPovChanged}
      />,
    );

    await advanceTimers(250);

    expect(MockStreetViewPanorama.instances).toHaveLength(1);
    const panorama = MockStreetViewPanorama.instances[0];

    await act(async () => {
      panorama.emit("pano_changed");
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(panorama.setPovCalls).toBeGreaterThanOrEqual(16);
    expect(panorama.setPovCalls).toBeLessThanOrEqual(28);
    expect(onPovChanged.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("stops automatic POV updates while the tab is hidden", async () => {
    render(
      <StreetView
        latitude={4.48275}
        longitude={-61.14854}
        onPovChanged={vi.fn()}
      />,
    );

    await advanceTimers(250);

    expect(MockStreetViewPanorama.instances).toHaveLength(1);
    const panorama = MockStreetViewPanorama.instances[0];

    await act(async () => {
      panorama.emit("pano_changed");
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    const callsBeforeHidden = panorama.setPovCalls;
    expect(callsBeforeHidden).toBeGreaterThan(0);

    await act(async () => {
      setDocumentVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(panorama.setPovCalls).toBe(callsBeforeHidden);
  });

  it("stops automatic POV updates while the page is not focused", async () => {
    render(
      <StreetView
        latitude={4.48275}
        longitude={-61.14854}
        onPovChanged={vi.fn()}
      />,
    );

    await advanceTimers(250);

    expect(MockStreetViewPanorama.instances).toHaveLength(1);
    const panorama = MockStreetViewPanorama.instances[0];

    await act(async () => {
      panorama.emit("pano_changed");
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    const callsBeforeBlur = panorama.setPovCalls;
    expect(callsBeforeBlur).toBeGreaterThan(0);

    await act(async () => {
      setDocumentFocus(false);
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(panorama.setPovCalls).toBe(callsBeforeBlur);
  });

  it("applies external heading changes to the panorama", async () => {
    const onPovChanged = vi.fn();
    const { rerender } = render(
      <StreetView
        latitude={4.48275}
        longitude={-61.14854}
        heading={0}
        onPovChanged={onPovChanged}
      />,
    );

    await advanceTimers(250);

    expect(MockStreetViewPanorama.instances).toHaveLength(1);
    const panorama = MockStreetViewPanorama.instances[0];

    await act(async () => {
      rerender(
        <StreetView
          latitude={4.48275}
          longitude={-61.14854}
          heading={135}
          onPovChanged={onPovChanged}
        />,
      );
      await Promise.resolve();
    });

    expect(panorama.getPov().heading).toBe(135);
    expect(onPovChanged).toHaveBeenCalledWith(135);
  });

  it("keeps the panorama when only the UI language changes", async () => {
    const { rerender } = render(<StreetView latitude={1} longitude={2} />);
    await advanceTimers(250);
    expect(MockStreetViewPanorama.instances).toHaveLength(1);

    translation.t = (key) => `zh:${key}`;
    rerender(<StreetView latitude={1} longitude={2} />);
    await advanceTimers(250);

    expect(MockStreetViewPanorama.instances).toHaveLength(1);
    expect(
      MockStreetViewPanorama.instances[0].setVisible,
    ).not.toHaveBeenCalled();
  });

  it("keeps the unavailable message instead of a later network timeout", async () => {
    render(<StreetView latitude={1} longitude={2} />);
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];

    await act(async () => {
      panorama.status = "ZERO_RESULTS";
      panorama.emit("status_changed");
    });
    await advanceTimers(10000);

    expect(screen.getByText("error.streetViewNotAvailable")).toBeTruthy();
    expect(screen.queryByText("error.networkConnectionFailed")).toBeNull();
  });

  it("stops auto-rotation while another full-screen layer covers it", async () => {
    const { rerender } = render(<StreetView latitude={1} longitude={2} />);
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];
    await act(async () => {
      panorama.emit("pano_changed");
      vi.advanceTimersByTime(2300);
      await Promise.resolve();
    });
    expect(panorama.setPovCalls).toBeGreaterThan(0);

    rerender(<StreetView latitude={1} longitude={2} paused />);
    const callsWhilePaused = panorama.setPovCalls;
    await advanceTimers(5000);
    expect(panorama.setPovCalls).toBe(callsWhilePaused);

    rerender(<StreetView latitude={1} longitude={2} />);
    await advanceTimers(1000);
    expect(panorama.setPovCalls).toBeGreaterThan(callsWhilePaused);
  });

  it("shows the interaction tip once per location, not on every step", async () => {
    render(<StreetView latitude={1} longitude={2} />);
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];

    await act(async () => panorama.emit("pano_changed"));
    await advanceTimers(3000);
    expect(screen.getByText("streetview.interactionTip")).toBeTruthy();
    await advanceTimers(8000);
    expect(screen.queryByText("streetview.interactionTip")).toBeNull();

    await act(async () => panorama.emit("pano_changed"));
    await advanceTimers(3500);
    expect(screen.queryByText("streetview.interactionTip")).toBeNull();
  });
});

describe("StreetView location switching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockStreetViewPanorama.instances = [];
    resetInteractionTipForTests();
    setDocumentVisibility("visible");
    setDocumentFocus(true);
    loadGoogleMapsWhenVisible.mockResolvedValue(mockMaps());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("opens the panorama by ID when the location has one", async () => {
    render(<StreetView panoId="uploaded-pano" latitude={1} longitude={2} />);
    await advanceTimers(250);

    const [panorama] = MockStreetViewPanorama.instances;
    expect(panorama.options.pano).toBe("uploaded-pano");
    expect(panorama.options.position).toBeUndefined();
  });

  it("loads an official panorama ID directly, without searching", async () => {
    const search = vi.spyOn(MockStreetViewService.prototype, "getPanorama");
    render(
      <StreetView panoId="RVHISCP2VhnDsPJUbAybGQ" latitude={1} longitude={2} />,
    );
    await advanceTimers(250);

    expect(MockStreetViewPanorama.instances[0].options.pano).toBe(
      "RVHISCP2VhnDsPJUbAybGQ",
    );
    expect(search).not.toHaveBeenCalled();
    search.mockRestore();
  });

  it("swaps a user photosphere for the nearest official panorama", async () => {
    render(
      <StreetView
        panoId="CAoSF0NJSE0wb2dLRUlDQWdNQ2d0Zl9GNVFF"
        latitude={1}
        longitude={2}
      />,
    );
    await advanceTimers(250);

    expect(MockStreetViewPanorama.instances[0].options.pano).toBe(
      "official-near",
    );
  });

  it("shows no imagery when only a user photosphere is nearby", async () => {
    const search = vi
      .spyOn(MockStreetViewService.prototype, "getPanorama")
      .mockRejectedValue(
        Object.assign(new Error("none"), { code: "ZERO_RESULTS" }),
      );
    render(
      <StreetView
        panoId="CAoSF0NJSE0wb2dLRUlDQWdNQ2d0Zl9GNVFF"
        latitude={1}
        longitude={2}
      />,
    );
    await advanceTimers(250);

    expect(MockStreetViewPanorama.instances).toHaveLength(0);
    expect(screen.getByText("error.streetViewNotAvailable")).toBeTruthy();
    search.mockRestore();
  });

  it("falls back to coordinates without a panorama ID", async () => {
    render(<StreetView latitude={1} longitude={2} />);
    await advanceTimers(250);

    const [panorama] = MockStreetViewPanorama.instances;
    expect(panorama.options.position).toEqual({ lat: 1, lng: 2 });
    expect(panorama.options.pano).toBeUndefined();
  });

  it("reuses the panorama and switches by ID when the location changes", async () => {
    const onViewChanged = vi.fn();
    const { rerender, container } = render(
      <StreetView
        panoId="pano-a"
        latitude={1}
        longitude={2}
        heading={40}
        onViewChanged={onViewChanged}
      />,
    );
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];
    await act(async () => panorama.emit("status_changed"));
    panorama.pov = { heading: 200, pitch: 12 };
    panorama.zoom = 3;
    onViewChanged.mockClear();

    rerender(
      <StreetView
        panoId="pano-b"
        latitude={3}
        longitude={4}
        heading={40}
        onViewChanged={onViewChanged}
      />,
    );
    await advanceTimers(250);

    expect(MockStreetViewPanorama.instances).toHaveLength(1);
    expect(panorama.setVisible).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('[data-testid="mock-panorama"]'),
    ).toHaveLength(1);
    expect(panorama.setPano).toHaveBeenCalledWith("pano-b");
    expect(panorama.setPosition).not.toHaveBeenCalled();
    expect(panorama.getPov()).toMatchObject({ heading: 40, pitch: 0 });
    expect(panorama.setZoom).toHaveBeenCalledWith(1);
    // setPano 自己触发的 pano_changed 不算加载完成，也不上报视野
    expect(onViewChanged).not.toHaveBeenCalled();

    await act(async () => panorama.emit("status_changed"));
    expect(onViewChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ panoId: "pano-b" }),
    );
  });

  it("reuses the panorama and moves by coordinates without an ID", async () => {
    const { rerender } = render(<StreetView latitude={1} longitude={2} />);
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];

    rerender(<StreetView latitude={3} longitude={4} />);
    await advanceTimers(250);

    expect(MockStreetViewPanorama.instances).toHaveLength(1);
    expect(panorama.setPosition).toHaveBeenCalledWith({ lat: 3, lng: 4 });
    expect(panorama.setPano).not.toHaveBeenCalled();
  });

  it("keeps the unavailable message for a missing panorama ID after switching", async () => {
    const { rerender } = render(<StreetView panoId="pano-a" />);
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];
    await act(async () => panorama.emit("status_changed"));

    rerender(<StreetView panoId="missing-pano" />);
    await advanceTimers(250);
    await act(async () => {
      panorama.status = "ZERO_RESULTS";
      panorama.emit("status_changed");
    });
    await advanceTimers(12000);

    expect(screen.getByText("error.streetViewNotAvailable")).toBeTruthy();
    expect(screen.queryByText("error.networkConnectionFailed")).toBeNull();
    expect(panorama.setPovCalls).toBe(1);
  });

  it("reports a network error when a new location never loads", async () => {
    const { rerender } = render(<StreetView latitude={1} longitude={2} />);
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];
    await act(async () => {
      panorama.pano = "pano-a";
      panorama.emit("pano_changed");
    });

    rerender(<StreetView latitude={3} longitude={4} />);
    await advanceTimers(10500);

    expect(screen.getByText("error.networkConnectionFailed")).toBeTruthy();
  });

  it("does not report a timeout when the reused panorama already shows the target", async () => {
    const { rerender } = render(<StreetView panoId="pano-a" />);
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];
    await act(async () => panorama.emit("status_changed"));

    // 状态一直是 OK，status_changed 没有再次触发
    rerender(<StreetView panoId="pano-b" />);
    await advanceTimers(10500);

    expect(screen.queryByText("error.networkConnectionFailed")).toBeNull();
  });

  it("treats position_changed as loaded when a reused panorama stays OK", async () => {
    const onViewChanged = vi.fn();
    const { rerender } = render(
      <StreetView panoId="pano-a" onViewChanged={onViewChanged} />,
    );
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];
    await act(async () => panorama.emit("status_changed"));
    await advanceTimers(12000);
    onViewChanged.mockClear();
    // 第一站已经弹过提示；重置后用第二站的提示判断后续动作是否按时到来
    resetInteractionTipForTests();

    // 状态保持 OK：只有新全景元数据到达时的 position_changed
    rerender(<StreetView panoId="pano-b" onViewChanged={onViewChanged} />);
    await advanceTimers(250);
    expect(onViewChanged).not.toHaveBeenCalled();
    await act(async () => panorama.emit("position_changed"));
    expect(onViewChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ panoId: "pano-b" }),
    );
    // 加载完成的后续动作按正常节奏到来，不用等 10 秒超时
    await advanceTimers(3000);
    expect(screen.getByText("streetview.interactionTip")).toBeTruthy();
  });

  it("shows the interaction tip only once per page load", async () => {
    const { rerender } = render(<StreetView panoId="pano-a" />);
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];
    await act(async () => panorama.emit("status_changed"));
    await advanceTimers(3000);
    expect(screen.getByText("streetview.interactionTip")).toBeTruthy();

    rerender(<StreetView panoId="pano-b" />);
    await advanceTimers(250);
    expect(screen.queryByText("streetview.interactionTip")).toBeNull();
    await act(async () => panorama.emit("status_changed"));
    await advanceTimers(3000);
    expect(screen.queryByText("streetview.interactionTip")).toBeNull();
  });

  it("still shows the tip at the next stop when it never got to appear", async () => {
    const { rerender } = render(<StreetView panoId="pano-a" />);
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];
    await act(async () => panorama.emit("status_changed"));
    await advanceTimers(1000);

    rerender(<StreetView panoId="pano-b" />);
    await advanceTimers(250);
    await act(async () => panorama.emit("status_changed"));
    await advanceTimers(3000);
    expect(screen.getByText("streetview.interactionTip")).toBeTruthy();
  });

  it("tells the panorama to redraw when its container changes size", async () => {
    let notifySize = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback) {
          notifySize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const trigger = vi.fn();
    vi.stubGlobal("google", { maps: { event: { trigger } } });
    try {
      render(<StreetView panoId="pano-a" />);
      await advanceTimers(250);
      const panorama = MockStreetViewPanorama.instances[0];

      // 连续几次尺寸变化只通知一次
      notifySize([]);
      notifySize([]);
      await advanceTimers(200);
      expect(trigger).toHaveBeenCalledTimes(1);
      expect(trigger).toHaveBeenCalledWith(panorama, "resize");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("destroys the panorama on unmount", async () => {
    const { unmount } = render(<StreetView panoId="pano-a" />);
    await advanceTimers(250);
    const panorama = MockStreetViewPanorama.instances[0];

    unmount();

    expect(panorama.setVisible).toHaveBeenCalledWith(false);
    expect(panorama.listeners.get("pano_changed").size).toBe(0);
  });
});
