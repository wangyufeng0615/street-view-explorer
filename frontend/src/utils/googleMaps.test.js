import { beforeEach, afterEach, it, expect, vi } from "vitest";
const language = vi.hoisted(() => ({ language: "zh" }));
vi.mock("../i18n", () => ({ default: language }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  delete window.google;
  language.language = "zh";
});
afterEach(() => {
  vi.useRealTimers();
  document
    .querySelectorAll("script[data-google-maps]")
    .forEach((s) => s.remove());
  delete window.google;
});

it("shares an in-flight SDK across language changes and never reloads a registered API", async () => {
  const { loadGoogleMapsScript } = await import("./googleMaps");
  const first = loadGoogleMapsScript();
  language.language = "en";
  const second = loadGoogleMapsScript();
  expect(first).toBe(second);
  const scripts = document.querySelectorAll("script[data-google-maps]");
  expect(scripts).toHaveLength(1);
  window.google = { maps: { Map: function Map() {} } };
  const api = window.google.maps;
  window[new URL(scripts[0].src).searchParams.get("callback")]();
  expect(await first).toBe(api);
  language.language = "zh";
  expect(await loadGoogleMapsScript()).toBe(api);
  expect(document.querySelectorAll("script[data-google-maps]")).toHaveLength(1);
});

it("disconnects the visibility observer when the wait is cancelled", async () => {
  const observers = [];
  class MockIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnect = vi.fn();
      this.observe = vi.fn();
      observers.push(this);
    }
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  try {
    const { loadGoogleMapsWhenVisible } = await import("./googleMaps");
    const controller = new AbortController();
    const pending = loadGoogleMapsWhenVisible(document.createElement("div"), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(observers[0].disconnect).toHaveBeenCalled();
    await expect(
      loadGoogleMapsWhenVisible(document.createElement("div"), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("preloads the SDK once and lets visible maps reuse the same script", async () => {
  const { preloadGoogleMaps, loadGoogleMapsWhenVisible } = await import(
    "./googleMaps"
  );
  const preload = preloadGoogleMaps();
  // jsdom 没有 IntersectionObserver，这里直接走立即加载分支
  const visible = loadGoogleMapsWhenVisible(document.createElement("div"));
  const scripts = document.querySelectorAll("script[data-google-maps]");
  expect(scripts).toHaveLength(1);
  window.google = { maps: { Map: function Map() {} } };
  window[new URL(scripts[0].src).searchParams.get("callback")]();
  expect(await visible).toBe(window.google.maps);
  expect(await preload).toBe(window.google.maps);
  expect(document.querySelectorAll("script[data-google-maps]")).toHaveLength(1);
});

it("swallows preload failures so the page can retry later", async () => {
  const { preloadGoogleMaps, loadGoogleMapsScript } = await import(
    "./googleMaps"
  );
  const preload = preloadGoogleMaps();
  document.querySelector("script[data-google-maps]").onerror();
  await expect(preload).resolves.toBeUndefined();
  loadGoogleMapsScript().catch(() => {});
  expect(document.querySelectorAll("script[data-google-maps]")).toHaveLength(1);
});
