import { describe, expect, it, vi } from "vitest";
import { initPreloadRecovery } from "./preloadRecovery";

function setup(storage = new Map()) {
  const browser = new EventTarget();
  browser.navigator = { onLine: true };
  browser.location = { reload: vi.fn() };
  browser.sessionStorage = {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
  };
  const dispose = initPreloadRecovery(browser);
  const fail = (
    message = "Unable to preload CSS for /assets/GlobalLoading-old.css",
  ) => {
    const event = new Event("vite:preloadError", { cancelable: true });
    event.payload = new Error(message);
    browser.dispatchEvent(event);
    return event;
  };
  return { browser, fail, dispose };
}

describe("Vite preload recovery", () => {
  it.each([
    "Unable to preload CSS for /assets/GlobalLoading-DSb6pXeC.css",
    "Failed to fetch dynamically imported module: /assets/page.js",
    "Importing a module script failed.",
    "error loading dynamically imported module: /assets/page.js",
  ])("refreshes once for %s", (message) => {
    const { browser, fail } = setup();
    expect(fail(message).defaultPrevented).toBe(true);
    expect(fail(message).defaultPrevented).toBe(true);
    expect(browser.location.reload).toHaveBeenCalledTimes(1);
  });

  it("does not loop after reload and lets persistent failures reach reporting", () => {
    const storage = new Map();
    setup(storage).fail();
    const { browser, fail } = setup(storage);
    expect(fail().defaultPrevented).toBe(false);
    expect(browser.location.reload).not.toHaveBeenCalled();
  });

  it("preserves application errors and offline failures", () => {
    const { browser, fail } = setup();
    expect(fail("Cannot read properties of undefined").defaultPrevented).toBe(
      false,
    );
    browser.navigator.onLine = false;
    expect(fail().defaultPrevented).toBe(false);
    expect(browser.location.reload).not.toHaveBeenCalled();
  });

  it.each(["getItem", "setItem"])(
    "does not reload if storage %s fails",
    (method) => {
      const { browser, fail } = setup();
      browser.sessionStorage[method] = () => {
        throw new Error("Storage blocked");
      };
      expect(fail().defaultPrevented).toBe(false);
      expect(browser.location.reload).not.toHaveBeenCalled();
    },
  );

  it("keeps the original error when reload fails", () => {
    const { browser, fail } = setup();
    browser.location.reload.mockImplementation(() => {
      throw new Error("Blocked");
    });
    expect(fail().defaultPrevented).toBe(false);
  });

  it("removes the listener when disposed", () => {
    const { browser, fail, dispose } = setup();
    dispose();
    expect(fail().defaultPrevented).toBe(false);
    expect(browser.location.reload).not.toHaveBeenCalled();
  });
});
