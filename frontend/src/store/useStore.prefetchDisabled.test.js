// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getRandomLocation: vi.fn(),
  streamLocationDescription: vi.fn(),
  markPrefetchedVisit: vi.fn(),
}));

vi.mock("./prefetchConfig", () => ({
  PREFETCH_NEXT_ENABLED: false,
  PREFETCH_TTL_MS: 15 * 60 * 1000,
}));

vi.mock("../services/api", () => ({
  getRandomLocation: apiMocks.getRandomLocation,
  streamLocationDescription: apiMocks.streamLocationDescription,
  markPrefetchedVisit: apiMocks.markPrefetchedVisit,
  setExplorationPreference: vi.fn(),
  deleteExplorationPreference: vi.fn(),
  lookupLocation: vi.fn(),
}));

vi.mock("../i18n", () => ({
  default: {
    language: "zh",
    resolvedLanguage: "zh",
    t: (key) => key,
    on: vi.fn(),
  },
}));

import useStore from "./useStore";

const CURRENT = { pano_id: "pano-current", latitude: 1, longitude: 2 };
const NEXT = { pano_id: "pano-next", latitude: 3, longitude: 4 };

describe("prefetch switched off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      isExplorationInitialized: true,
      explorationMode: "random",
      explorationInterest: "",
      isSavingPreference: false,
      isLoadingLocation: false,
      location: CURRENT,
      currentLocationRef: CURRENT,
      description: "当前地点讲解",
      descriptionError: null,
      isDescriptionLoading: false,
      userExploreCount: 0,
      lastRefreshTime: 0,
      heading: 90,
    });
  });

  it("keeps the on-demand explore path unchanged", async () => {
    apiMocks.getRandomLocation.mockResolvedValue({ success: true, data: NEXT });
    apiMocks.streamLocationDescription.mockResolvedValue({
      success: true,
      data: { description: "下一站讲解" },
    });

    await useStore
      .getState()
      .loadRandomLocation(false, { userInitiated: true });
    expect(useStore.getState().userExploreCount).toBe(0);
    expect(apiMocks.getRandomLocation).toHaveBeenCalledTimes(1);
    expect(apiMocks.getRandomLocation).toHaveBeenCalledWith("zh");
    expect(useStore.getState().heading).toBe(90);

    await useStore.getState().loadLocationDescription(NEXT.pano_id);
    useStore.setState({ userExploreCount: 3 });
    expect(useStore.getState().maybePrefetchNext()).toBe(false);
    expect(apiMocks.getRandomLocation).toHaveBeenCalledTimes(1);
    expect(apiMocks.streamLocationDescription).toHaveBeenCalledTimes(1);
    expect(apiMocks.streamLocationDescription.mock.calls[0][3]).toEqual({
      heading: 90,
      pitch: 0,
      fov: 90,
    });
    expect(apiMocks.markPrefetchedVisit).not.toHaveBeenCalled();
  });
});
