import React, { useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streetViewMounts: 0,
  streetViewProps: [],
  preloadGoogleMaps: vi.fn(),
  showCover: false,
  preloadCoverImage: vi.fn(),
}));

// 封面桩：只验证首页怎样挂载、暂停街景和收起它
vi.mock("./utils/coverGate", () => ({
  shouldShowCover: () => mocks.showCover,
  coverPlaceForThisVisit: () => ({
    id: "namib",
    zh: "纳米布沙海",
    en: "Namib",
    lat: 0,
    lng: 0,
  }),
  preloadCoverImage: mocks.preloadCoverImage,
}));

vi.mock("./components/cover/CoverOverlay", () => ({
  default: ({ place, onClose }) => (
    <div data-testid="cover" data-place={place.id}>
      <button type="button" onClick={onClose}>
        enter street view
      </button>
    </div>
  ),
}));

// 首页用真实组件，只把重的子组件换成桩；街景桩记录挂载次数和收到的 paused
vi.mock("./components/StreetView", () => ({
  default: function MockStreetView(props) {
    mocks.streetViewProps.push(props);
    useEffect(() => {
      mocks.streetViewMounts += 1;
    }, []);
    return <div data-testid="street-view" />;
  },
}));

vi.mock("./components/home/HomeNav", () => ({
  default: ({ onOpenFootprint }) => (
    <button type="button" onClick={onOpenFootprint}>
      open footprints
    </button>
  ),
}));
vi.mock("./components/home/HomeMiniMap", () => ({ default: () => null }));
vi.mock("./components/home/AtlasLetter", () => ({ default: () => null }));
vi.mock("./components/home/HomeDock", () => ({ default: () => null }));
vi.mock("./components/FootprintMap", () => ({
  default: ({ onClose }) => (
    <div data-testid="footprint-map">
      <button type="button" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

vi.mock("./utils/googleMaps", () => ({
  preloadGoogleMaps: mocks.preloadGoogleMaps,
}));

vi.mock("./services/sentryLazy", () => ({ testSentry: vi.fn() }));

vi.mock("./services/api", () => ({
  getRandomLocation: vi.fn(),
  lookupLocation: vi.fn(),
  streamLocationDescription: vi.fn(() => new Promise(() => {})),
  setExplorationPreference: vi.fn(),
  deleteExplorationPreference: vi.fn(),
}));

import "./i18n";
import App from "./App";
import useStore from "./store/useStore";
import {
  getRandomLocation,
  lookupLocation,
  streamLocationDescription,
} from "./services/api";

const INITIAL_STORE_STATE = useStore.getState();

const PLACE = {
  pano_id: "pano-home",
  latitude: 1,
  longitude: 2,
  formatted_address: "Somewhere",
};

function lastStreetViewProps() {
  return mocks.streetViewProps[mocks.streetViewProps.length - 1];
}

async function renderHomeAndOpenFootprints() {
  render(<App />);
  await waitFor(() => expect(getRandomLocation).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(lastStreetViewProps()).toMatchObject({ panoId: "pano-home" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "open footprints" }));
  await screen.findByTestId("footprint-map");
}

async function expectBackOnHome() {
  await waitFor(() => expect(screen.queryByTestId("footprint-map")).toBeNull());
  expect(window.location.pathname).toBe("/");
  expect(window.location.search).toBe("?lat=1.00000&lng=2.00000");
  expect(screen.getByTestId("street-view")).toBeTruthy();
  expect(lastStreetViewProps().paused).toBe(false);
  // 首页没有重新挂载，也没有重新取位置或重新生成讲解
  expect(mocks.streetViewMounts).toBe(1);
  expect(getRandomLocation).toHaveBeenCalledTimes(1);
  expect(streamLocationDescription).toHaveBeenCalledTimes(1);
}

describe("home cover", () => {
  beforeEach(() => {
    mocks.streetViewMounts = 0;
    mocks.streetViewProps = [];
    mocks.showCover = true;
    getRandomLocation.mockResolvedValue({ success: true, data: PLACE });
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
    mocks.showCover = false;
    useStore.setState(INITIAL_STORE_STATE, true);
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("loads the first stop under the cover with Street View paused", async () => {
    render(<App />);

    expect((await screen.findByTestId("cover")).dataset.place).toBe("namib");
    // 决定显示封面的同时就开始下载封面图
    expect(mocks.preloadCoverImage).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(lastStreetViewProps()).toMatchObject({
        panoId: "pano-home",
        paused: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "enter street view" }));

    await waitFor(() => expect(screen.queryByTestId("cover")).toBeNull());
    expect(lastStreetViewProps().paused).toBe(false);
    expect(mocks.streetViewMounts).toBe(1);
    expect(getRandomLocation).toHaveBeenCalledTimes(1);
  });
});

describe("footprint routes", () => {
  beforeEach(() => {
    mocks.streetViewMounts = 0;
    mocks.streetViewProps = [];
    getRandomLocation.mockResolvedValue({ success: true, data: PLACE });
    lookupLocation.mockResolvedValue({ success: true, data: PLACE });
  });

  afterEach(() => {
    cleanup();
    useStore.setState(INITIAL_STORE_STATE, true);
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
  });

  describe("opened from the home page", () => {
    beforeEach(() => {
      window.history.replaceState(null, "", "/");
    });

    it("keeps the home page mounted under the overlay and pauses Street View", async () => {
      await renderHomeAndOpenFootprints();

      expect(window.location.pathname).toBe("/footprints");
      expect(window.location.search).toBe("?lat=1.00000&lng=2.00000");
      expect(screen.getByTestId("street-view")).toBeTruthy();
      expect(lastStreetViewProps().paused).toBe(true);
      expect(mocks.streetViewMounts).toBe(1);
    });

    it("goes back to the same home page when the overlay closes", async () => {
      await renderHomeAndOpenFootprints();

      fireEvent.click(screen.getByRole("button", { name: "close" }));

      await expectBackOnHome();
    });

    it("handles the browser back button like the close button", async () => {
      await renderHomeAndOpenFootprints();

      await act(async () => window.history.back());

      await expectBackOnHome();
    });
  });

  describe("visited directly", () => {
    it("renders only the footprint map and opens the home page on close", async () => {
      window.history.replaceState(
        null,
        "",
        "/footprints?lat=1.00000&lng=2.00000",
      );
      render(<App />);

      expect(await screen.findByTestId("footprint-map")).toBeTruthy();
      expect(screen.queryByTestId("street-view")).toBeNull();
      expect(mocks.preloadGoogleMaps).toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "close" }));

      expect(await screen.findByTestId("street-view")).toBeTruthy();
      expect(screen.queryByTestId("footprint-map")).toBeNull();
      expect(window.location.pathname).toBe("/");
      expect(window.location.search).toBe("?lat=1.00000&lng=2.00000");
    });

    it("treats a refreshed overlay entry as a direct visit", async () => {
      // 刷新后 history.state 里仍有 backgroundLocation，但首页并没有挂在底下
      window.history.replaceState(
        {
          usr: { backgroundLocation: { pathname: "/", search: "", hash: "" } },
          key: "overlay",
          idx: 1,
        },
        "",
        "/footprints",
      );
      render(<App />);

      expect(await screen.findByTestId("footprint-map")).toBeTruthy();
      expect(screen.queryByTestId("street-view")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "close" }));

      expect(await screen.findByTestId("street-view")).toBeTruthy();
      expect(window.location.pathname).toBe("/");
    });
  });
});
