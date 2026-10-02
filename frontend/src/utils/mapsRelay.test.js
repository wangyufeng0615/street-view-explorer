import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

it("never registers a worker unless the URL explicitly opts in", async () => {
  const register = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  const { isMapsRelayEnabled, prepareMapsRelay } = await import("./mapsRelay");
  for (const search of ["", "?mapsRelay=0", "?mapsRelay=true"]) {
    window.history.replaceState(null, "", "/" + search);
    expect(isMapsRelayEnabled()).toBe(false);
    await prepareMapsRelay();
  }
  expect(register).not.toHaveBeenCalled();
});

it("waits for control, shares preparation and can reclaim a refreshed page", async () => {
  window.history.replaceState(null, "", "/?mapsRelay=1");
  vi.stubGlobal("isSecureContext", true);
  const workers = new EventTarget();
  workers.controller = null;
  const postMessage = vi.fn(() => {
    workers.controller = {
      scriptURL: "http://localhost/api/v1/maps-relay/service-worker.js?v=2",
    };
    workers.dispatchEvent(new Event("controllerchange"));
  });
  workers.register = vi.fn().mockResolvedValue({ active: { postMessage } });
  vi.stubGlobal("navigator", { serviceWorker: workers });
  const { prepareMapsRelay } = await import("./mapsRelay");
  const first = prepareMapsRelay();
  expect(prepareMapsRelay()).toBe(first);
  await first;
  expect(postMessage).toHaveBeenCalledWith({ type: "maps-relay-claim" });
  expect(workers.register).toHaveBeenCalledTimes(1);
});

it("fails visibly when activation is unavailable instead of enabling direct access", async () => {
  window.history.replaceState(null, "", "/?mapsRelay=1");
  vi.stubGlobal("isSecureContext", true);
  const workers = new EventTarget();
  workers.controller = null;
  workers.register = vi.fn().mockResolvedValue({});
  workers.ready = new Promise(() => {});
  vi.stubGlobal("navigator", { serviceWorker: workers });
  vi.useFakeTimers();
  const { prepareMapsRelay } = await import("./mapsRelay");
  const result = expect(prepareMapsRelay()).rejects.toThrow(
    "activation timed out",
  );
  await vi.advanceTimersByTimeAsync(15000);
  await result;
});

it("consumes invitations from the fragment without sending them in URLs", async () => {
  window.history.replaceState(
    null,
    "",
    "/?mapsRelay=1#mapsRelayKey=test-invitation",
  );
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      controller: {
        scriptURL: "http://localhost/api/v1/maps-relay/service-worker.js?v=2",
      },
      register: vi.fn().mockResolvedValue({}),
    },
  });
  const { prepareMapsRelay } = await import("./mapsRelay");
  await prepareMapsRelay();
  expect(window.location.hash).toBe("");
  expect(fetch.mock.calls[0][0]).toBe("/api/v1/maps-relay/session");
  expect(fetch.mock.calls[0][1].headers).toEqual({
    "X-Maps-Relay-Key": "test-invitation",
  });
});

it("bounds registration itself and rejects unauthorized access", async () => {
  window.history.replaceState(null, "", "/?mapsRelay=1");
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    serviceWorker: { register: () => new Promise(() => {}) },
  });
  vi.useFakeTimers();
  const { prepareMapsRelay } = await import("./mapsRelay");
  const pending = expect(prepareMapsRelay()).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(15000);
  await pending;
  fetch.mockResolvedValue({ ok: false, status: 401 });
  await expect(prepareMapsRelay()).rejects.toThrow("invitation");
});
