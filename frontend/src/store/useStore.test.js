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
import i18n from "../i18n";
import {
  deleteExplorationPreference,
  setExplorationPreference,
  getRandomLocation,
  lookupLocation,
} from "../services/api";

describe("exploration preference synchronization", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    const storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    });
    useStore.setState({
      isSavingPreference: false,
      isLoadingLocation: false,
      isExplorationInitialized: false,
      explorationMode: "custom",
      explorationInterest: "mountains",
    });
  });

  it("preserves custom mode when deletion fails", async () => {
    localStorage.setItem("exploration_mode", "custom");
    localStorage.setItem("exploration_interest", "mountains");
    deleteExplorationPreference.mockResolvedValue({
      success: false,
      error: "offline",
    });
    await useStore.getState().handleModeChange("random");
    expect(useStore.getState().explorationMode).toBe("custom");
    expect(localStorage.getItem("exploration_interest")).toBe("mountains");
    expect(useStore.getState().preferenceError).toBe("offline");
    expect(getRandomLocation).not.toHaveBeenCalled();
  });

  it("waits for the restored preference before the first location and deduplicates initialization", async () => {
    localStorage.setItem("exploration_mode", "custom");
    localStorage.setItem("exploration_interest", "mountains");
    let resolve;
    setExplorationPreference.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    getRandomLocation.mockResolvedValue({
      success: true,
      data: { latitude: 1, longitude: 2 },
    });
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

describe("location loading errors", () => {
  const CURRENT = { pano_id: "pano-current", latitude: 1, longitude: 2 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    useStore.getState().cancelLocationDescription();
    useStore.setState({
      isExplorationInitialized: true,
      isLoadingLocation: false,
      isLocationLoading: false,
      location: CURRENT,
      currentLocationRef: CURRENT,
      locationError: null,
      lastRefreshTime: 0,
      showToast: false,
      toastMessage: "",
    });
  });

  afterEach(() => {
    useStore.getState().cancelLocationDescription();
    vi.restoreAllMocks();
  });

  it("shows a toast instead of the error page when exploring too fast", async () => {
    useStore.setState({ lastRefreshTime: Date.now() });
    const result = await useStore.getState().loadRandomLocation();
    expect(result).toMatchObject({ success: false, rateLimited: true });
    expect(useStore.getState()).toMatchObject({
      locationError: null,
      location: CURRENT,
      showToast: true,
    });
    expect(getRandomLocation).not.toHaveBeenCalled();
  });

  it("still reports a user-initiated failure on the page", async () => {
    getRandomLocation.mockResolvedValue({ success: false, error: "down" });
    const result = await useStore.getState().loadRandomLocation(true);
    expect(result).toEqual({ success: false, error: "down" });
    expect(useStore.getState().locationError).toBe("down");
  });

  it("keeps the current place when a preserving lookup fails", async () => {
    lookupLocation.mockResolvedValue({ success: false, error: "no pano" });
    const result = await useStore
      .getState()
      .loadLocationFromURL(3, 4, { preserveLocation: true });
    expect(result).toEqual({ success: false, error: "no pano" });
    expect(useStore.getState()).toMatchObject({
      location: CURRENT,
      locationError: null,
      isLoadingLocation: false,
    });
  });

  it("stops the old narration from streaming into a location that is loading", async () => {
    let pushOldDelta;
    let oldSignal;
    apiMocks.streamLocationDescription.mockImplementation(
      (_id, _lang, signal, _view, onDelta) => {
        oldSignal = signal;
        pushOldDelta = onDelta;
        return new Promise(() => {});
      },
    );
    useStore.getState().loadLocationDescription("pano-current");
    getRandomLocation.mockReturnValue(new Promise(() => {}));

    useStore.getState().loadRandomLocation(true);
    await Promise.resolve();
    pushOldDelta("旧地点的讲解");

    expect(oldSignal.aborted).toBe(true);
    expect(useStore.getState()).toMatchObject({
      location: null,
      description: null,
      isDescriptionLoading: false,
    });
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
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    useStore.getState().cancelLocationDescription();
    apiMocks.streamLocationDescription.mockReset();
    i18n.resolvedLanguage = "zh";
    useStore.setState({
      isDescriptionLoading: false,
      descriptionRequestKey: null,
      currentLocationRef: { pano_id: "pano-1" },
      streetViewView: null,
      heading: 0,
      networkState: true,
    });
  });

  afterEach(() => {
    useStore.getState().cancelLocationDescription();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cancels the pending automatic retry when the network goes offline", async () => {
    apiMocks.streamLocationDescription.mockResolvedValue({
      success: false,
      error: "failure",
    });
    await useStore.getState().loadLocationDescription("pano-1");
    useStore.setState({ networkState: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(1);
    expect(useStore.getState().descriptionError).toBe("ai.descriptionFailed");
  });

  it("retries a quick empty failure once and stops on a second failure", async () => {
    apiMocks.streamLocationDescription.mockResolvedValue({
      success: false,
      error: "temporary failure",
    });
    await useStore.getState().loadLocationDescription("pano-1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(2);
    expect(useStore.getState().descriptionError).toBe("ai.descriptionFailed");
    await vi.advanceTimersByTimeAsync(60000);
    expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(2);
  });

  it("finishes normally when the one automatic retry succeeds", async () => {
    apiMocks.streamLocationDescription
      .mockResolvedValueOnce({ success: false, error: "temporary failure" })
      .mockResolvedValueOnce({
        success: true,
        data: {
          description: "完整讲解",
          research_status: "verified",
          citations: [],
        },
      });
    await useStore.getState().loadLocationDescription("pano-1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(useStore.getState()).toMatchObject({
      description: "完整讲解",
      descriptionError: null,
      isDescriptionLoading: false,
      descriptionResearchStatus: "verified",
    });
  });

  it("preserves partial prose without citations or completion claims and does not retry", async () => {
    useStore.setState({ descriptionResearchStatus: "verified" });
    apiMocks.streamLocationDescription.mockImplementation(
      async (_id, _lang, _signal, _view, onDelta) => {
        onDelta("已经显示的内容");
        return { success: false, error: "upstream timeout" };
      },
    );
    await useStore.getState().loadLocationDescription("pano-1");
    expect(useStore.getState()).toMatchObject({
      description: "已经显示的内容",
      descriptionCitations: null,
      descriptionResearchStatus: null,
      descriptionError: "ai.descriptionFailed",
      isDescriptionLoading: false,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a slow request that exhausted the model deadline", async () => {
    apiMocks.streamLocationDescription.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ success: false, error: "timeout" }),
            25000,
          ),
        ),
    );
    const pending = useStore.getState().loadLocationDescription("pano-1");
    await vi.advanceTimersByTimeAsync(25000);
    await pending;
    await vi.advanceTimersByTimeAsync(60000);
    expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(1);
    expect(useStore.getState().descriptionError).toBe("ai.descriptionFailed");
  });

  it.each(["offline", "aborted"])(
    "does not retry an %s failure",
    async (kind) => {
      if (kind === "offline") useStore.setState({ networkState: false });
      apiMocks.streamLocationDescription.mockResolvedValue({
        success: false,
        error: "failure",
        aborted: kind === "aborted",
      });
      await useStore.getState().loadLocationDescription("pano-1");
      await vi.advanceTimersByTimeAsync(1000);
      expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["cancel", "language", "location", "manual"])(
    "invalidates an older scheduled retry on %s",
    async (change) => {
      apiMocks.streamLocationDescription
        .mockResolvedValueOnce({ success: false, error: "failure" })
        .mockResolvedValue({ success: true, data: { description: "新内容" } });
      await useStore.getState().loadLocationDescription("pano-1");
      if (change === "cancel") useStore.getState().cancelLocationDescription();
      if (change === "language") i18n.resolvedLanguage = "en";
      if (change === "location")
        useStore.setState({ currentLocationRef: { pano_id: "pano-2" } });
      if (change === "manual")
        await useStore.getState().loadLocationDescription("pano-1");
      const calls = apiMocks.streamLocationDescription.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(calls);
    },
  );

  it("ignores a late result after cancel and restart of the same view", async () => {
    let finishOld;
    apiMocks.streamLocationDescription
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValue({ success: true, data: { description: "新内容" } });
    const old = useStore.getState().loadLocationDescription("pano-1");
    useStore.getState().cancelLocationDescription();
    await useStore.getState().loadLocationDescription("pano-1");
    finishOld({ success: true, data: { description: "旧内容" } });
    await old;
    expect(useStore.getState().description).toBe("新内容");
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
