import React, { useRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import useFeedSwipe from "./useFeedSwipe";

// jsdom 没有 PointerEvent，用 MouseEvent 补一个够用的
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

afterEach(cleanup);

function Feed({ handlers }) {
  const areaRef = useRef(null);
  useFeedSwipe(areaRef, { enabled: true, ignoreSelector: "a", ...handlers });
  return (
    <div ref={areaRef}>
      <div data-testid="panorama" />
      <a href="#x">Google</a>
    </div>
  );
}

function setup() {
  const handlers = {
    onStart: vi.fn(),
    onMove: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
  };
  render(<Feed handlers={handlers} />);
  const panorama = screen.getByTestId("panorama");
  const seen = { pointermove: 0, pointerup: 0, pointercancel: 0 };
  Object.keys(seen).forEach((type) =>
    panorama.addEventListener(type, () => {
      seen[type] += 1;
    }),
  );
  const pointer = (type, x, y, pointerType = "touch") =>
    panorama.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 3,
        pointerType,
        isPrimary: true,
      }),
    );
  return { handlers, seen, pointer };
}

describe("useFeedSwipe", () => {
  it("takes over a vertical drag and makes the street view drop its own", () => {
    const { handlers, seen, pointer } = setup();
    pointer("pointerdown", 100, 500);
    pointer("pointermove", 101, 496);
    // 还没判断方向的小移动照常交给街景
    expect(seen.pointermove).toBe(1);
    expect(handlers.onStart).not.toHaveBeenCalled();

    pointer("pointermove", 102, 470);
    pointer("pointermove", 103, 400);
    pointer("pointerup", 103, 300);

    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    expect(seen.pointercancel).toBe(1);
    expect(seen.pointermove).toBe(1);
    expect(seen.pointerup).toBe(0);
    expect(handlers.onMove).toHaveBeenLastCalledWith(-100);
    expect(handlers.onEnd).toHaveBeenCalledWith(-200, expect.any(Number));
  });

  it("leaves sideways drags to the street view", () => {
    const { handlers, seen, pointer } = setup();
    pointer("pointerdown", 100, 500);
    pointer("pointermove", 140, 505);
    pointer("pointermove", 200, 510);
    pointer("pointerup", 200, 510);

    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(seen.pointermove).toBe(2);
    expect(seen.pointerup).toBe(1);
    expect(seen.pointercancel).toBe(0);
  });

  it("does not turn mouse drags into swipes", () => {
    const { handlers, seen, pointer } = setup();
    pointer("pointerdown", 100, 500, "mouse");
    pointer("pointermove", 100, 300, "mouse");
    pointer("pointerup", 100, 300, "mouse");

    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(seen.pointermove).toBe(1);
  });

  it("ignores drags that start on a link", () => {
    const { handlers } = setup();
    const link = screen.getByText("Google");
    const fire = (type, y) =>
      link.dispatchEvent(
        new window.PointerEvent(type, {
          bubbles: true,
          clientX: 10,
          clientY: y,
          pointerId: 4,
          pointerType: "touch",
        }),
      );
    fire("pointerdown", 500);
    fire("pointermove", 300);
    fire("pointerup", 300);
    expect(handlers.onStart).not.toHaveBeenCalled();
  });
});
