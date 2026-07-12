import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  streamLocationDescription: vi.fn(),
}));

vi.mock("../services/api", () => ({
  getRandomLocation: vi.fn(),
  streamLocationDescription: apiMocks.streamLocationDescription,
  setExplorationPreference: vi.fn(),
  deleteExplorationPreference: vi.fn(),
  lookupLocation: vi.fn(),
}));

vi.mock("../i18n", () => ({
  default: {
    language: "zh",
    resolvedLanguage: "zh",
    t: (key) => key,
  },
}));

import useStore from "./useStore";

describe("toast lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMocks.streamLocationDescription.mockReset();
    useStore.setState({
      toastMessage: "",
      showToast: false,
      isDescriptionLoading: false,
      descriptionRequestKey: null,
      currentLocationRef: null,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("does not let an older timer hide a newer toast", () => {
    useStore.getState().showToastMessage("first");
    vi.advanceTimersByTime(2000);
    useStore.getState().showToastMessage("second");

    vi.advanceTimersByTime(1100);
    expect(useStore.getState().showToast).toBe(true);
    expect(useStore.getState().toastMessage).toBe("second");

    vi.advanceTimersByTime(1900);
    expect(useStore.getState().showToast).toBe(false);
  });
});

describe("description request lifecycle", () => {
  beforeEach(() => {
    apiMocks.streamLocationDescription.mockReset();
    useStore.setState({
      isDescriptionLoading: false,
      descriptionRequestKey: null,
      currentLocationRef: { pano_id: "pano-1" },
      streetViewView: null,
      heading: 0,
    });
  });

  it("aborts the active request when the page cleanup runs", async () => {
    let receivedSignal;
    apiMocks.streamLocationDescription.mockImplementation(
      (_panoId, _language, signal) => {
        receivedSignal = signal;
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ success: false, aborted: true }),
            { once: true },
          );
        });
      },
    );

    const request = useStore.getState().loadLocationDescription("pano-1");
    expect(useStore.getState().isDescriptionLoading).toBe(true);

    useStore.getState().cancelLocationDescription();
    await request;

    expect(receivedSignal.aborted).toBe(true);
    expect(useStore.getState().isDescriptionLoading).toBe(false);
    expect(useStore.getState().descriptionRequestKey).toBeNull();
  });
});
