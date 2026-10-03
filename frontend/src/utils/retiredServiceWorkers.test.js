import { afterEach, describe, expect, it, vi } from "vitest";
import { unregisterRetiredServiceWorkers } from "./retiredServiceWorkers";

function registration(scriptURL) {
  return { active: { scriptURL }, unregister: vi.fn(() => Promise.resolve()) };
}

describe("unregisterRetiredServiceWorkers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("removes only the retired maps relay worker", async () => {
    const relay = registration(
      "https://earth.wangyufeng.org/api/v1/maps-relay/service-worker.js?v=3",
    );
    const other = registration("https://earth.wangyufeng.org/sw.js");
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: () => Promise.resolve([relay, other]),
      },
    });

    await unregisterRetiredServiceWorkers();

    expect(relay.unregister).toHaveBeenCalledTimes(1);
    expect(other.unregister).not.toHaveBeenCalled();
  });

  it("does nothing where service workers are unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(unregisterRetiredServiceWorkers()).resolves.toBeUndefined();
  });
});
