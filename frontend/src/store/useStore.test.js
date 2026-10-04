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
  getLocalizedAddress: vi.fn(),
}));

vi.mock("../i18n", () => ({
  default: {
    language: "zh",
    resolvedLanguage: "zh",
    t: (key) => key,
  },
}));

import useStore, { forgetFinishedDescriptionsForTests } from "./useStore";
import i18n from "../i18n";
import {
  deleteExplorationPreference,
  setExplorationPreference,
  getRandomLocation,
  lookupLocation,
  getLocalizedAddress,
} from "../services/api";

// 写完的讲解按全景缓存在模块里，用例之间清空
beforeEach(() => forgetFinishedDescriptionsForTests());

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
    // 后端的原始错误只进控制台，界面给当前语言的提示
    expect(useStore.getState().preferenceError).toBe("error.preferenceFailed");
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

  it.each([
    ["a first visit", null],
    ["a saved random mode", "random"],
  ])(
    "starts the first random location without syncing preferences on %s",
    async (_label, savedMode) => {
      if (savedMode) localStorage.setItem("exploration_mode", savedMode);
      getRandomLocation.mockResolvedValue({
        success: true,
        data: { latitude: 1, longitude: 2 },
      });

      const init = useStore.getState().initializeExplorationMode();
      expect(useStore.getState()).toMatchObject({
        isExplorationInitialized: true,
        isSavingPreference: false,
        explorationMode: "random",
        explorationInterest: "",
      });
      await init;
      await useStore.getState().loadRandomLocation(true);

      expect(deleteExplorationPreference).not.toHaveBeenCalled();
      expect(setExplorationPreference).not.toHaveBeenCalled();
      expect(getRandomLocation).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["custom mode without an interest", { exploration_mode: "custom" }],
    ["an interest without custom mode", { exploration_interest: "mountains" }],
  ])(
    "clears the backend preference before exploring with %s",
    async (_label, saved) => {
      for (const [key, value] of Object.entries(saved)) {
        localStorage.setItem(key, value);
      }
      let resolve;
      deleteExplorationPreference.mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      getRandomLocation.mockResolvedValue({
        success: true,
        data: { latitude: 1, longitude: 2 },
      });

      const load = useStore.getState().loadRandomLocation(true);
      await Promise.resolve();
      expect(deleteExplorationPreference).toHaveBeenCalledTimes(1);
      expect(getRandomLocation).not.toHaveBeenCalled();
      resolve({ success: true });
      await load;

      expect(useStore.getState().explorationMode).toBe("random");
      expect(getRandomLocation).toHaveBeenCalledTimes(1);
    },
  );
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
    getRandomLocation.mockResolvedValue({
      success: false,
      status: 500,
      error: "down",
    });
    const result = await useStore.getState().loadRandomLocation(true);
    expect(result).toEqual({ success: false, error: "error.locationFailed" });
    expect(useStore.getState().locationError).toBe("error.locationFailed");
  });

  it("explains rate limits and network failures in the UI language", async () => {
    getRandomLocation.mockResolvedValue({
      success: false,
      status: 429,
      error: "请求过于频繁，请稍后再试",
    });
    expect(await useStore.getState().loadRandomLocation(true)).toEqual({
      success: false,
      error: "error.tooManyRequests",
    });

    getRandomLocation.mockResolvedValue({
      success: false,
      status: 0,
      error: "error.requestTimeout",
    });
    expect(await useStore.getState().loadRandomLocation(true)).toEqual({
      success: false,
      error: "error.requestTimeout",
    });
  });

  it("keeps the current place when a preserving lookup fails", async () => {
    lookupLocation.mockResolvedValue({
      success: false,
      status: 404,
      error: "no pano",
    });
    const result = await useStore
      .getState()
      .loadLocationFromURL(3, 4, { preserveLocation: true });
    expect(result).toEqual({ success: false, error: "mapPicker.failed" });
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

  it("keeps the narration when a map pick lands on the panorama already shown", async () => {
    useStore.setState({ description: "当前讲解" });
    lookupLocation.mockResolvedValue({
      success: true,
      data: { ...CURRENT, latitude: 1.00001 },
    });
    const result = await useStore.getState().loadLocationFromMapPick(1, 2);
    expect(result).toMatchObject({ success: true, unchanged: true });
    expect(useStore.getState()).toMatchObject({
      location: CURRENT,
      description: "当前讲解",
      isMapLocationLoading: false,
    });
  });

  it("lets a direct navigation end an in-flight load without leaving it busy", async () => {
    let finishRandom;
    getRandomLocation.mockReturnValue(
      new Promise((resolve) => {
        finishRandom = resolve;
      }),
    );
    const pending = useStore.getState().loadRandomLocation(true);
    expect(useStore.getState().isLoadingLocation).toBe(true);

    const OLD_STOP = { pano_id: "pano-old", latitude: 5, longitude: 6 };
    useStore.getState().applyNavigatedLocation(OLD_STOP);
    expect(useStore.getState()).toMatchObject({
      location: OLD_STOP,
      isLoadingLocation: false,
      isLocationLoading: false,
    });

    // 新的一次出发开始后，被作废的请求才结束：不能把新请求的忙碌状态清掉
    let finishSecond;
    getRandomLocation.mockReturnValue(
      new Promise((resolve) => {
        finishSecond = resolve;
      }),
    );
    const second = useStore.getState().loadRandomLocation(true);
    finishRandom({
      success: true,
      data: { pano_id: "pano-stale", latitude: 1, longitude: 1 },
    });
    expect(await pending).toMatchObject({ superseded: true });
    expect(useStore.getState()).toMatchObject({
      location: null,
      isLoadingLocation: true,
    });

    finishSecond({
      success: true,
      data: { pano_id: "pano-new", latitude: 2, longitude: 2 },
    });
    await second;
    expect(useStore.getState()).toMatchObject({
      location: { pano_id: "pano-new" },
      isLoadingLocation: false,
    });
  });

  it("does not clear the narration when navigation targets the current panorama", () => {
    useStore.setState({ description: "当前讲解" });
    useStore.getState().applyNavigatedLocation({ ...CURRENT });
    expect(useStore.getState()).toMatchObject({
      location: CURRENT,
      description: "当前讲解",
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

describe("address language", () => {
  const englishTokyo = {
    pano_id: "pano-tokyo",
    latitude: 35.66,
    longitude: 139.7,
    formatted_address: "Shibuya, Tokyo, Japan",
    country: "Japan",
    country_code: "JP",
    city: "Tokyo",
    address_language: "en",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      location: englishTokyo,
      currentLocationRef: englishTokyo,
    });
  });

  it("tags loaded locations with the language their address is in", async () => {
    getRandomLocation.mockResolvedValue({
      success: true,
      data: { pano_id: "p", latitude: 1, longitude: 2 },
    });
    useStore.setState({
      isLoadingLocation: false,
      isExplorationInitialized: true,
    });
    await useStore.getState().loadRandomLocation(true);
    expect(useStore.getState().location.address_language).toBe("zh");
  });

  it("swaps only the address fields into the UI language", async () => {
    getLocalizedAddress.mockResolvedValue({
      success: true,
      data: {
        formatted_address: "日本东京都涩谷区",
        country: "日本",
        country_code: "JP",
        city: "",
      },
    });
    await useStore.getState().relocalizeLocationAddress();

    expect(getLocalizedAddress).toHaveBeenCalledWith(35.66, 139.7, "zh");
    expect(useStore.getState().location).toMatchObject({
      pano_id: "pano-tokyo",
      formatted_address: "日本东京都涩谷区",
      country: "日本",
      city: "Tokyo",
      address_language: "zh",
    });
  });

  it("drops a late answer after the explorer moved on", async () => {
    let resolveAddress;
    getLocalizedAddress.mockReturnValue(
      new Promise((resolve) => {
        resolveAddress = resolve;
      }),
    );
    const pending = useStore.getState().relocalizeLocationAddress();
    const nextStop = { ...englishTokyo, pano_id: "pano-next" };
    useStore.setState({ location: nextStop });
    resolveAddress({
      success: true,
      data: { formatted_address: "日本东京都涩谷区" },
    });
    await pending;

    expect(useStore.getState().location).toBe(nextStop);
  });

  it("does not ask again when the address already matches", async () => {
    useStore.setState({
      location: { ...englishTokyo, address_language: "zh" },
    });
    await useStore.getState().relocalizeLocationAddress();
    expect(getLocalizedAddress).not.toHaveBeenCalled();
  });
});
