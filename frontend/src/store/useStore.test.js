// @vitest-environment jsdom
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
import { deleteExplorationPreference, setExplorationPreference, getRandomLocation } from '../services/api';

describe('exploration preference synchronization', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) });
    useStore.setState({ isSavingPreference: false, isLoadingLocation: false,
      isExplorationInitialized: false, explorationMode: 'custom', explorationInterest: 'mountains' });
  });

  it('preserves custom mode when deletion fails', async () => {
    localStorage.setItem('exploration_mode', 'custom');
    localStorage.setItem('exploration_interest', 'mountains');
    deleteExplorationPreference.mockResolvedValue({ success: false, error: 'offline' });
    await useStore.getState().handleModeChange('random');
    expect(useStore.getState().explorationMode).toBe('custom');
    expect(localStorage.getItem('exploration_interest')).toBe('mountains');
    expect(useStore.getState().preferenceError).toBe('offline');
    expect(getRandomLocation).not.toHaveBeenCalled();
  });

  it('waits for the restored preference before the first location and deduplicates initialization', async () => {
    localStorage.setItem('exploration_mode', 'custom');
    localStorage.setItem('exploration_interest', 'mountains');
    let resolve;
    setExplorationPreference.mockImplementation(() => new Promise(r => { resolve = r; }));
    getRandomLocation.mockResolvedValue({ success: true, data: { latitude: 1, longitude: 2 } });
    const init = useStore.getState().initializeExplorationMode();
    const load = useStore.getState().loadRandomLocation(true);
    expect(useStore.getState().isExplorationInitialized).toBe(false);
    expect(getRandomLocation).not.toHaveBeenCalled();
    resolve({ success: true });
    await Promise.all([init, load]);
    expect(setExplorationPreference).toHaveBeenCalledTimes(1);
    expect(getRandomLocation).toHaveBeenCalledTimes(1);
  });
});

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
