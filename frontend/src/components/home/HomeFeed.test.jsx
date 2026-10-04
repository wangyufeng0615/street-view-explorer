import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const store = vi.hoisted(() => ({ hook: null }));

vi.mock("../../store/useStore", async () => {
  const { create } = await import("zustand");
  store.hook = create(() => ({ prefetchedLocation: null, heading: 0 }));
  return { default: store.hook };
});
vi.mock("../StreetView", () => ({
  default: ({ panoId, paused }) => (
    <div data-testid={`pano-${panoId}`} data-paused={String(paused)} />
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { resolvedLanguage: "zh", language: "zh" },
  }),
}));

import HomeFeed from "./HomeFeed";

beforeAll(() => {
  if (typeof window.PointerEvent === "function") return;
  class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEvent;
});

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage?.clear?.();
  store.hook.setState({ prefetchedLocation: null, heading: 0 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const place = (id) => ({
  pano_id: id,
  latitude: 1,
  longitude: 2,
  formatted_address: `place ${id}`,
});
const stop = (id) => ({
  panoId: id,
  lat: 1,
  lng: 2,
  label: `place ${id}`,
});

function renderFeed(props) {
  const handlers = { onNext: vi.fn(), onPrev: vi.fn() };
  const view = render(
    <HomeFeed
      isBusy={false}
      paused={false}
      hasLanded
      swipeEnabled
      description=""
      isLoadingDesc={false}
      descError={null}
      onOpenLetter={vi.fn()}
      {...handlers}
      {...props}
    />,
  );
  return { ...view, ...handlers };
}

function swipe(target, fromY, toY) {
  const fire = (type, y) =>
    act(() => {
      target.dispatchEvent(
        new window.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: y,
          pointerId: 9,
          pointerType: "touch",
          isPrimary: true,
        }),
      );
    });
  fire("pointerdown", fromY);
  const step = (toY - fromY) / 6;
  for (let i = 1; i <= 6; i += 1) fire("pointermove", fromY + step * i);
  fire("pointerup", toY);
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

describe("HomeFeed", () => {
  it("prepares the prefetched place in a hidden card and swipes up to it", () => {
    store.hook.setState({ prefetchedLocation: place("b") });
    const { onNext } = renderFeed({
      location: place("a"),
      journeyStops: [stop("a")],
    });

    const next = screen.getByTestId("pano-b");
    expect(next.dataset.paused).toBe("true");
    expect(next.closest(".home-feed__slot").dataset.role).toBe("next");

    swipe(screen.getByTestId("pano-a"), 600, 300);
    expect(onNext).toHaveBeenCalledWith(null);
  });

  it("goes forward through the trip before asking for a new place", () => {
    store.hook.setState({ prefetchedLocation: place("z") });
    const { onNext } = renderFeed({
      location: place("a"),
      journeyStops: [stop("a"), stop("b")],
    });

    expect(
      screen.getByTestId("pano-b").closest(".home-feed__slot").dataset.role,
    ).toBe("next");
    swipe(screen.getByTestId("pano-a"), 600, 300);
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ panoId: "b" }));
  });

  it("loads the previous stop only once the user pulls down, then goes back", () => {
    const { onPrev } = renderFeed({
      location: place("b"),
      journeyStops: [stop("a"), stop("b")],
    });
    expect(screen.queryByTestId("pano-a")).toBeNull();

    swipe(screen.getByTestId("pano-b"), 200, 520);
    expect(screen.getByTestId("pano-a")).toBeTruthy();
    expect(onPrev).toHaveBeenCalledWith(expect.objectContaining({ panoId: "a" }));
  });

  it("springs back without switching on a short drag or while busy", () => {
    store.hook.setState({ prefetchedLocation: place("b") });
    const { onNext, rerender } = renderFeed({
      location: place("a"),
      journeyStops: [stop("a")],
    });
    swipe(screen.getByTestId("pano-a"), 600, 570);
    expect(onNext).not.toHaveBeenCalled();

    rerender(
      <HomeFeed
        location={place("a")}
        journeyStops={[stop("a")]}
        isBusy
        paused={false}
        hasLanded
        swipeEnabled
        onNext={onNext}
        onPrev={vi.fn()}
      />,
    );
    swipe(screen.getByTestId("pano-a"), 600, 200);
    expect(onNext).not.toHaveBeenCalled();
  });
});
