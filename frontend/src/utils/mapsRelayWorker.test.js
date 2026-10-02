// @vitest-environment node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(
  new URL(
    "../../../backend/internal/api/maps_relay_worker.js",
    import.meta.url,
  ),
  "utf8",
)
  .replace("__MAPS_RELAY_HOSTS__", '["maps.googleapis.com"]')
  .replace("__MAPS_RELAY_ENABLED__", "true");

function workerHarness(pages, fetch) {
  const unregister = vi.fn();
  const listeners = {};
  vm.runInNewContext(source, {
    self: {
      location: { origin: "https://app.test" },
      clients: {
        get: async (id) => pages[id],
        matchAll: async () => Object.values(pages),
      },
      registration: { unregister },
      addEventListener: (type, listener) => (listeners[type] = listener),
    },
    URL,
    Headers,
    Response,
    fetch,
  });
  const handle = (clientId, request) => {
    let response;
    listeners.fetch({
      clientId,
      request,
      respondWith: (result) => (response = result),
    });
    return response;
  };
  handle.release = () => {
    let completion;
    listeners.message({
      data: { type: "maps-relay-release" },
      waitUntil: (promise) => {
        completion = promise;
      },
    });
    return completion;
  };
  handle.unregister = unregister;
  return handle;
}

it("isolates opt-in per tab, including a fresh worker and a changed URL", async () => {
  const pages = {
    enabled: { url: "https://app.test/?mapsRelay=1" },
    ordinary: { url: "https://app.test/" },
  };
  const fetch = vi.fn().mockResolvedValue(new Response("SDK"));
  const handle = workerHarness(pages, fetch);
  const request = new Request(
    "https://maps.googleapis.com/maps/api/js?key=existing",
  );
  await handle("enabled", request);
  expect(fetch.mock.calls[0][0]).toBe(
    "https://app.test/api/v1/maps-relay/resource/maps.googleapis.com/maps/api/js?key=existing",
  );
  expect(fetch.mock.calls[0][1].headers.get("X-Maps-Relay")).toBe("1");
  await handle("ordinary", request);
  expect(fetch.mock.calls[1][0]).toBe(request);
  pages.enabled.url = "https://app.test/?mapsRelay=0";
  await handle("enabled", request);
  expect(fetch.mock.calls[2][0]).toBe(request);
  expect(
    handle("enabled", new Request("https://other.test/image")),
  ).toBeUndefined();
});

it("forwards RPC bodies and never falls back to Google after a relay failure", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("relay offline"));
  const handle = workerHarness(
    { page: { url: "https://app.test/?mapsRelay=1" } },
    fetch,
  );
  const response = await handle(
    "page",
    new Request("https://maps.googleapis.com/$rpc/google.internal.maps.test", {
      method: "POST",
      cache: "no-store",
      body: "opaque RPC",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Maps-Api-Signature": "sdk-signature",
        "X-Goog-Maps-Api-Salt": "sdk-salt",
        Authorization: "Bearer app-secret",
      },
    }),
  );
  expect(response.status).toBe(502);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].cache).toBe("no-store");
  expect(fetch.mock.calls[0][1].headers.get("X-Goog-Maps-Api-Signature")).toBe(
    "sdk-signature",
  );
  expect(fetch.mock.calls[0][1].headers.get("X-Goog-Maps-Api-Salt")).toBe(
    "sdk-salt",
  );
  expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBeNull();
  expect(new TextDecoder().decode(fetch.mock.calls[0][1].body)).toBe(
    "opaque RPC",
  );
});

it("rejects missing clients and unknown Google hosts without a direct request", async () => {
  const postMessage = vi.fn();
  const fetch = vi.fn();
  const handle = workerHarness(
    {
      on: { url: "https://app.test/?mapsRelay=1", postMessage },
      frame: { url: "about:blank", type: "window" },
    },
    fetch,
  );
  expect(
    (
      await handle(
        "missing",
        new Request("https://maps.googleapis.com/maps/api/js"),
      )
    ).status,
  ).toBe(503);
  expect(
    (
      await handle(
        "on",
        new Request("https://new.googleapis.com/tile?key=secret"),
      )
    ).status,
  ).toBe(502);
  expect(postMessage).toHaveBeenCalledWith({
    type: "maps-relay-blocked-host",
    host: "new.googleapis.com",
  });
  expect(
    (
      await handle(
        "frame",
        new Request("https://maps.googleapis.com/maps/api/js"),
      )
    ).status,
  ).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
});

it("unregisters only after the last opted-in tab has left", async () => {
  const pages = {
    on: { url: "https://app.test/?mapsRelay=1" },
    off: { url: "https://app.test/" },
  };
  const handle = workerHarness(pages, vi.fn());
  await handle.release();
  expect(handle.unregister).not.toHaveBeenCalled();
  pages.on.url = "https://app.test/?mapsRelay=0";
  await handle.release();
  expect(handle.unregister).toHaveBeenCalledTimes(1);
});
