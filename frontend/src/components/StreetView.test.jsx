import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StreetView from "./StreetView";
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
    this.setVisible = vi.fn();
    this.pov = { ...options.pov };
    this.listeners = new Map();
    this.setPovCalls = 0;
    this.status = "OK";
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
  it("removes the old panorama DOM and hides its instance when location changes", async () => {
    const { rerender, container } = render(
      <StreetView latitude={1} longitude={2} />,
    );
    await advanceTimers(250);
    const old = MockStreetViewPanorama.instances[0];
    rerender(<StreetView latitude={3} longitude={4} />);
    await advanceTimers(250);
    expect(old.setVisible).toHaveBeenCalledWith(false);
    expect(
      container.querySelectorAll('[data-testid="mock-panorama"]'),
    ).toHaveLength(1);
  });
  beforeEach(() => {
    vi.useFakeTimers();
    MockStreetViewPanorama.instances = [];
    setDocumentVisibility("visible");
    setDocumentFocus(true);
    loadGoogleMapsWhenVisible.mockResolvedValue({
      StreetViewPanorama: MockStreetViewPanorama,
    });
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
