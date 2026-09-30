// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getRandomLocation: vi.fn(),
  streamLocationDescription: vi.fn(),
  markPrefetchedVisit: vi.fn(),
}));

const i18nMock = vi.hoisted(() => {
  const listeners = {};
  return {
    listeners,
    instance: {
      language: "zh",
      resolvedLanguage: "zh",
      t: (key) => key,
      on: (event, listener) => {
        (listeners[event] ||= []).push(listener);
      },
    },
  };
});

vi.mock("../services/api", () => ({
  getRandomLocation: apiMocks.getRandomLocation,
  streamLocationDescription: apiMocks.streamLocationDescription,
  markPrefetchedVisit: apiMocks.markPrefetchedVisit,
  setExplorationPreference: vi.fn(),
  deleteExplorationPreference: vi.fn(),
  lookupLocation: vi.fn(),
}));

vi.mock("../i18n", () => ({ default: i18nMock.instance }));

import useStore from "./useStore";

const CURRENT = { pano_id: "pano-current", latitude: 1, longitude: 2 };
const NEXT = { pano_id: "pano-next", latitude: 3, longitude: 4 };
const OTHER = { pano_id: "pano-other", latitude: 5, longitude: 6 };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function emitLanguageChanged(language) {
  if (language) i18nMock.instance.resolvedLanguage = language;
  for (const listener of i18nMock.listeners.languageChanged || []) {
    listener(language);
  }
}

function isPrefetchCall(call) {
  return Boolean(call[1] && typeof call[1] === "object" && call[1].prefetch);
}

function prefetchCalls() {
  return apiMocks.getRandomLocation.mock.calls.filter(isPrefetchCall);
}

function normalRandomCalls() {
  return apiMocks.getRandomLocation.mock.calls.filter(
    (call) => !isPrefetchCall(call),
  );
}

// 每次讲解请求都返回一个可手动推送片段、手动结束的流
function controllableStreams() {
  const streams = [];
  apiMocks.streamLocationDescription.mockImplementation(
    (panoId, language, signal, view, onDelta) => {
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      signal?.addEventListener(
        "abort",
        () => resolve({ success: false, aborted: true, error: "aborted" }),
        { once: true },
      );
      streams.push({
        panoId,
        language,
        signal,
        view,
        push: (delta) => onDelta?.(delta),
        finish: (description, extra = {}) =>
          resolve({
            success: true,
            data: { description, citations: [], ...extra },
          }),
        fail: (error = "upstream failed") => resolve({ success: false, error }),
      });
      return promise;
    },
  );
  return streams;
}

// 预取请求和正常请求各自返回指定地点；传入 promise 可以让预取停在取位置阶段
function randomLocations({ prefetch = NEXT, normal = OTHER } = {}) {
  apiMocks.getRandomLocation.mockImplementation((_lang, options) => {
    const isPrefetch = options && typeof options === "object";
    const value = isPrefetch ? prefetch : normal;
    if (value instanceof Promise) return value;
    return Promise.resolve(
      value ? { success: true, data: value } : { success: false, error: "x" },
    );
  });
}

// 当前地点讲解已结束、用户已经主动探索过一次
function settleCurrentPlace(overrides = {}) {
  useStore.setState({
    location: CURRENT,
    currentLocationRef: CURRENT,
    description: "当前地点讲解",
    descriptionCitations: [{ url: "https://a.example", title: "A" }],
    descriptionResearchStatus: "verified",
    descriptionError: null,
    isDescriptionLoading: false,
    userExploreCount: 1,
    ...overrides,
  });
}

function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  setVisibility("visible");
  i18nMock.instance.resolvedLanguage = "zh";
  // 语言变化会清空槽位，借它在用例之间重置模块级预取状态
  emitLanguageChanged("zh");
  useStore.getState().cancelLocationDescription();
  apiMocks.markPrefetchedVisit.mockResolvedValue({ success: true });
  useStore.setState({
    isExplorationInitialized: true,
    explorationMode: "random",
    explorationInterest: "",
    isSavingPreference: false,
    isLoadingLocation: false,
    isLocationLoading: false,
    location: null,
    currentLocationRef: null,
    locationError: null,
    description: null,
    descriptionCitations: null,
    descriptionResearchStatus: null,
    descriptionError: null,
    isDescriptionLoading: false,
    userExploreCount: 0,
    lastRefreshTime: 0,
    heading: 0,
    streetViewView: null,
    networkState: true,
  });
});

afterEach(() => {
  emitLanguageChanged("zh");
  useStore.getState().cancelLocationDescription();
  vi.restoreAllMocks();
  setVisibility("visible");
});

describe("when prefetching starts", () => {
  it("skips the first place and starts only after a user explore finishes its narration", async () => {
    const streams = controllableStreams();
    randomLocations({ normal: CURRENT });
    // 首屏自动加载的第一站
    settleCurrentPlace({ userExploreCount: 0 });
    expect(useStore.getState().maybePrefetchNext()).toBe(false);

    // 语音或模式切换触发的加载不算主动探索
    await useStore.getState().loadRandomLocation(true);
    expect(useStore.getState().userExploreCount).toBe(0);
    useStore.setState({ lastRefreshTime: 0 });

    await useStore
      .getState()
      .loadRandomLocation(false, { userInitiated: true });
    expect(useStore.getState().userExploreCount).toBe(1);
    const narration = useStore
      .getState()
      .loadLocationDescription(CURRENT.pano_id);
    expect(useStore.getState().maybePrefetchNext()).toBe(false);

    streams[0].finish("当前地点讲解");
    await narration;
    expect(useStore.getState().maybePrefetchNext()).toBe(true);
    expect(prefetchCalls()).toHaveLength(1);
    expect(prefetchCalls()[0][0]).toBe("zh");
    expect(prefetchCalls()[0][1]).toMatchObject({ prefetch: true });
  });

  it("also starts after the current narration failed", () => {
    randomLocations({ prefetch: new Promise(() => {}) });
    settleCurrentPlace({
      description: null,
      descriptionError: "ai.descriptionFailed",
    });
    expect(useStore.getState().maybePrefetchNext()).toBe(true);
  });

  it.each([
    [
      "the narration is loading",
      () => settleCurrentPlace({ isDescriptionLoading: true }),
    ],
    [
      "the narration has not started",
      () => settleCurrentPlace({ description: null }),
    ],
    [
      "the page is hidden",
      () => {
        settleCurrentPlace();
        setVisibility("hidden");
      },
    ],
    [
      "a location is loading",
      () => settleCurrentPlace({ isLoadingLocation: true }),
    ],
    [
      "custom mode has no interest",
      () =>
        settleCurrentPlace({
          explorationMode: "custom",
          explorationInterest: "",
        }),
    ],
  ])("does not prefetch while %s", (_label, arrange) => {
    randomLocations();
    arrange();
    expect(useStore.getState().maybePrefetchNext()).toBe(false);
    expect(apiMocks.getRandomLocation).not.toHaveBeenCalled();
  });

  it("does not prefetch while the footprint overlay is open", () => {
    randomLocations();
    settleCurrentPlace();
    expect(useStore.getState().maybePrefetchNext({ overlayOpen: true })).toBe(
      false,
    );
    expect(apiMocks.getRandomLocation).not.toHaveBeenCalled();
  });

  it("keeps a single prefetch in flight", () => {
    randomLocations({ prefetch: new Promise(() => {}) });
    settleCurrentPlace({
      explorationMode: "custom",
      explorationInterest: "海",
    });
    expect(useStore.getState().maybePrefetchNext()).toBe(true);
    expect(useStore.getState().maybePrefetchNext()).toBe(false);
    expect(prefetchCalls()).toHaveLength(1);
  });

  it("requests the narration at heading 0 without touching the current place", async () => {
    const streams = controllableStreams();
    randomLocations();
    settleCurrentPlace();
    const before = useStore.getState();

    useStore.getState().maybePrefetchNext();
    await flush();
    expect(streams).toHaveLength(1);
    expect(streams[0].panoId).toBe(NEXT.pano_id);
    expect(streams[0].view).toEqual({ heading: 0, pitch: 0, fov: 90 });

    streams[0].push("下一站的开头");
    streams[0].finish("下一站完整讲解", { research_status: "verified" });
    await flush();

    const after = useStore.getState();
    expect(after.location).toBe(before.location);
    expect(after.description).toBe("当前地点讲解");
    expect(after.descriptionCitations).toBe(before.descriptionCitations);
    expect(after.descriptionResearchStatus).toBe("verified");
    expect(after.isDescriptionLoading).toBe(false);
    expect(after.descriptionRequestKey).toBe(before.descriptionRequestKey);
  });
});

describe("using a prefetched place", () => {
  async function prefetchReady(streams) {
    randomLocations();
    settleCurrentPlace();
    useStore.getState().maybePrefetchNext();
    await flush();
    return streams[streams.length - 1];
  }

  it("shows a finished narration immediately without new requests", async () => {
    const streams = controllableStreams();
    const stream = await prefetchReady(streams);
    const citations = [{ url: "https://b.example", title: "B" }];
    stream.finish("下一站完整讲解", {
      citations,
      research_status: "verified",
    });
    await flush();
    useStore.setState({
      heading: 137,
      streetViewView: { panoId: CURRENT.pano_id, heading: 137 },
    });
    const randomCalls = apiMocks.getRandomLocation.mock.calls.length;

    const result = await useStore
      .getState()
      .loadRandomLocation(false, { userInitiated: true });

    expect(result).toMatchObject({ success: true, data: NEXT });
    expect(apiMocks.getRandomLocation).toHaveBeenCalledTimes(randomCalls);
    expect(useStore.getState()).toMatchObject({
      location: NEXT,
      currentLocationRef: NEXT,
      description: "下一站完整讲解",
      descriptionCitations: citations,
      descriptionResearchStatus: "verified",
      descriptionError: null,
      isDescriptionLoading: false,
      heading: 0,
      streetViewView: null,
      isLoadingLocation: false,
      isLocationLoading: false,
    });
    expect(apiMocks.markPrefetchedVisit).toHaveBeenCalledWith(NEXT.pano_id);

    // 首页 effect 对新全景再调一次讲解加载时不会发请求
    await useStore.getState().loadLocationDescription(NEXT.pano_id);
    expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(1);
    expect(useStore.getState().description).toBe("下一站完整讲解");
  });

  it("still applies the 1 second client rate limit", async () => {
    const streams = controllableStreams();
    const stream = await prefetchReady(streams);
    stream.finish("下一站完整讲解");
    await flush();
    useStore.setState({ lastRefreshTime: Date.now() });

    const result = await useStore.getState().loadRandomLocation();
    expect(result).toMatchObject({ success: false, rateLimited: true });
    expect(useStore.getState().location).toEqual(CURRENT);
  });

  it("only warns when the footprint backfill fails", async () => {
    const streams = controllableStreams();
    apiMocks.markPrefetchedVisit.mockResolvedValue({
      success: false,
      status: 404,
      error: "not prefetched",
    });
    const stream = await prefetchReady(streams);
    stream.finish("下一站完整讲解");
    await flush();

    const result = await useStore.getState().loadRandomLocation();
    await flush();
    expect(result.success).toBe(true);
    expect(console.warn).toHaveBeenCalled();
    expect(useStore.getState().location).toEqual(NEXT);
  });

  it("keeps streaming a narration that is still being written into the new place", async () => {
    const streams = controllableStreams();
    const stream = await prefetchReady(streams);
    stream.push("第一段");

    await useStore
      .getState()
      .loadRandomLocation(false, { userInitiated: true });
    expect(useStore.getState()).toMatchObject({
      location: NEXT,
      description: "第一段",
      isDescriptionLoading: true,
      heading: 0,
    });

    // 首页 effect 不会为这个全景再开一条流
    const adopted = useStore.getState().loadLocationDescription(NEXT.pano_id);
    // 预取已被使用，讲解未结束前不会开始下一次预取
    expect(useStore.getState().maybePrefetchNext()).toBe(false);

    stream.push("第二段");
    expect(useStore.getState().description).toBe("第一段第二段");

    stream.finish("第一段第二段完整", {
      citations: [{ url: "https://c.example", title: "C" }],
      research_status: "verified",
    });
    await adopted;
    expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(1);
    expect(useStore.getState()).toMatchObject({
      description: "第一段第二段完整",
      descriptionResearchStatus: "verified",
      isDescriptionLoading: false,
    });
    expect(useStore.getState().descriptionCitations).toHaveLength(1);
  });

  it("shows the failure message when an adopted stream fails", async () => {
    const streams = controllableStreams();
    const stream = await prefetchReady(streams);
    stream.push("半段");
    await useStore.getState().loadRandomLocation();

    stream.fail();
    await flush();
    expect(useStore.getState()).toMatchObject({
      location: NEXT,
      description: "半段",
      descriptionError: "ai.descriptionFailed",
      isDescriptionLoading: false,
    });

    // 失败后的手动重试照常发起新请求
    useStore.getState().loadLocationDescription(NEXT.pano_id);
    expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(2);
  });

  it("stops an adopted stream when the user explores again", async () => {
    const streams = controllableStreams();
    const stream = await prefetchReady(streams);
    stream.push("第一段");
    await useStore
      .getState()
      .loadRandomLocation(false, { userInitiated: true });

    // 槽位已经用掉，这次走正常路径
    const next = useStore
      .getState()
      .loadRandomLocation(true, { userInitiated: true });
    expect(stream.signal.aborted).toBe(true);
    await next;
    expect(normalRandomCalls()).toHaveLength(1);
    expect(useStore.getState().location).toEqual(OTHER);

    stream.push("不该出现");
    stream.finish("不该出现");
    await flush();
    expect(useStore.getState().description).toBeNull();
  });

  it("is not cancelled by the current narration being cancelled before adoption", async () => {
    const streams = controllableStreams();
    const stream = await prefetchReady(streams);
    useStore.getState().cancelLocationDescription();
    expect(stream.signal.aborted).toBe(false);

    stream.finish("下一站完整讲解");
    await flush();
    await useStore.getState().loadRandomLocation();
    expect(useStore.getState().description).toBe("下一站完整讲解");
  });

  it("lets voice random navigation use the prefetched place", async () => {
    const streams = controllableStreams();
    const stream = await prefetchReady(streams);
    stream.finish("下一站完整讲解");
    await flush();

    const result = await useStore
      .getState()
      .loadRandomLocation(true, { preserveLocation: true });
    expect(result).toMatchObject({ success: true, data: NEXT });
    expect(normalRandomCalls()).toHaveLength(0);
    expect(useStore.getState().description).toBe("下一站完整讲解");
  });

  it("does not count voice navigation as a user explore", async () => {
    const streams = controllableStreams();
    const stream = await prefetchReady(streams);
    stream.finish("下一站完整讲解");
    await flush();
    await useStore
      .getState()
      .loadRandomLocation(true, { preserveLocation: true });
    expect(useStore.getState().userExploreCount).toBe(1);
  });

  it("starts the next prefetch once the adopted place is done", async () => {
    const streams = controllableStreams();
    const stream = await prefetchReady(streams);
    stream.finish("下一站完整讲解");
    await flush();
    await useStore.getState().loadRandomLocation();

    randomLocations({ prefetch: new Promise(() => {}) });
    expect(useStore.getState().maybePrefetchNext()).toBe(true);
    expect(prefetchCalls()).toHaveLength(2);
  });
});

describe("falling back to the normal path", () => {
  it.each([
    ["the language changes", () => emitLanguageChanged("en"), "en"],
    [
      "the exploration interest changes",
      () =>
        useStore.setState({
          explorationMode: "custom",
          explorationInterest: "mountains",
        }),
      "zh",
    ],
  ])("drops and aborts the prefetch when %s", async (_label, change, lang) => {
    const streams = controllableStreams();
    randomLocations();
    settleCurrentPlace();
    useStore.getState().maybePrefetchNext();
    await flush();
    const stream = streams[0];

    change();
    expect(stream.signal.aborted).toBe(true);

    await useStore.getState().loadRandomLocation();
    expect(normalRandomCalls()).toHaveLength(1);
    expect(normalRandomCalls()[0][0]).toBe(lang);
    expect(useStore.getState().location).toEqual(OTHER);
  });

  it("drops a prefetch whose narration failed", async () => {
    const streams = controllableStreams();
    randomLocations();
    settleCurrentPlace();
    useStore.getState().maybePrefetchNext();
    await flush();
    streams[0].fail();
    await flush();

    await useStore.getState().loadRandomLocation();
    expect(normalRandomCalls()).toHaveLength(1);
    expect(useStore.getState().location).toEqual(OTHER);
    expect(apiMocks.markPrefetchedVisit).not.toHaveBeenCalled();
    // 失败后不自动重试，等下一次满足条件
    expect(prefetchCalls()).toHaveLength(1);
  });

  it("drops a prefetch whose location request failed", async () => {
    controllableStreams();
    randomLocations({ prefetch: null });
    settleCurrentPlace();
    useStore.getState().maybePrefetchNext();
    await flush();

    await useStore.getState().loadRandomLocation();
    expect(normalRandomCalls()).toHaveLength(1);
    expect(apiMocks.streamLocationDescription).not.toHaveBeenCalled();
  });

  it("aborts a prefetch that is still fetching its location", async () => {
    let prefetchSignal;
    apiMocks.getRandomLocation.mockImplementation((_lang, options) => {
      if (options && typeof options === "object") {
        prefetchSignal = options.signal;
        return new Promise(() => {});
      }
      return Promise.resolve({ success: true, data: OTHER });
    });
    settleCurrentPlace();
    useStore.getState().maybePrefetchNext();

    await useStore.getState().loadRandomLocation();
    expect(prefetchSignal.aborted).toBe(true);
    expect(useStore.getState().location).toEqual(OTHER);
  });

  it("ignores a prefetch older than 15 minutes", async () => {
    const streams = controllableStreams();
    randomLocations();
    settleCurrentPlace();
    useStore.getState().maybePrefetchNext();
    await flush();
    streams[0].finish("下一站完整讲解");
    await flush();

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 15 * 60 * 1000 + 1);
    await useStore.getState().loadRandomLocation();
    expect(useStore.getState().location).toEqual(OTHER);
    expect(normalRandomCalls()).toHaveLength(1);
  });

  it("does not use or clear the slot for map picks and shared links", async () => {
    const streams = controllableStreams();
    randomLocations();
    settleCurrentPlace();
    useStore.getState().maybePrefetchNext();
    await flush();
    streams[0].finish("下一站完整讲解");
    await flush();

    useStore.getState().applyNavigatedLocation(OTHER);
    expect(streams[0].signal.aborted).toBe(false);

    await useStore.getState().loadRandomLocation();
    expect(useStore.getState()).toMatchObject({
      location: NEXT,
      description: "下一站完整讲解",
    });
  });

  it("aborts an unfinished prefetch when leaving the home page", async () => {
    const streams = controllableStreams();
    randomLocations();
    settleCurrentPlace();
    useStore.getState().maybePrefetchNext();
    await flush();

    useStore.getState().stopPrefetch();
    expect(streams[0].signal.aborted).toBe(true);
    await useStore.getState().loadRandomLocation();
    expect(useStore.getState().location).toEqual(OTHER);
  });
});
