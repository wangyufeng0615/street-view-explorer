const WORKER_PATH = "/api/v1/maps-relay/service-worker.js";
const WORKER_VERSION = "3";
let preparation = null;

export function isMapsRelayEnabled() {
  return new URLSearchParams(window.location.search).get("mapsRelay") === "1";
}

function isRelayController(worker) {
  if (!worker) return false;
  const url = new URL(worker.scriptURL);
  return (
    url.pathname === WORKER_PATH && url.searchParams.get("v") === WORKER_VERSION
  );
}

// Ordinary loads remain synchronous. The previous worker checks all live tabs
// before unregistering, so closing a test does not disrupt another test tab.
export function releaseMapsRelay() {
  if (!isMapsRelayEnabled()) {
    navigator.serviceWorker?.controller?.postMessage({
      type: "maps-relay-release",
    });
  }
}

async function authorizeRelay(signal) {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const key = window.__mapsRelayInvitation || fragment.get("mapsRelayKey");
  delete window.__mapsRelayInvitation;
  if (key) {
    fragment.delete("mapsRelayKey");
    const url = new URL(window.location.href);
    url.hash = fragment.toString();
    window.history.replaceState(window.history.state, "", url);
  }
  const response = await fetch("/api/v1/maps-relay/session", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: key ? { "X-Maps-Relay-Key": key } : {},
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Maps relay test invitation is missing or expired"
        : "Maps relay is unavailable",
    );
}

async function activateRelay(signal) {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    throw new Error("Maps relay requires HTTPS and Service Worker support");
  }
  const workers = navigator.serviceWorker;
  const [registration] = await Promise.all([
    workers.register(`${WORKER_PATH}?v=${WORKER_VERSION}`, {
      scope: "/",
      updateViaCache: "none",
    }),
    authorizeRelay(signal),
  ]);
  if (signal.aborted) throw signal.reason;
  if (!isRelayController(workers.controller)) {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        workers.removeEventListener("controllerchange", finish);
        signal.removeEventListener("abort", abort);
      };
      const finish = () => {
        if (!isRelayController(workers.controller)) return;
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      workers.addEventListener("controllerchange", finish);
      signal.addEventListener("abort", abort, { once: true });
      // Reclaim after force refresh; a newly installing worker claims on activation.
      registration.active?.postMessage({ type: "maps-relay-claim" });
      finish();
    });
  }
  if (
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1" &&
    !document.querySelector("link[data-maps-relay-font]")
  ) {
    const font = document.createElement("link");
    font.rel = "stylesheet";
    font.href =
      "https://fonts.googleapis.com/css2?family=Comfortaa:wght@300;400;500;600;700&display=swap";
    font.setAttribute("data-maps-relay-font", "true");
    document.head.appendChild(font);
  }
}

export function prepareMapsRelay() {
  if (!isMapsRelayEnabled()) return Promise.resolve();
  if (!preparation) {
    const controller = new AbortController();
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error("Maps relay activation timed out");
        controller.abort(error);
        reject(error);
      }, 15000);
    });
    preparation = Promise.race([activateRelay(controller.signal), deadline])
      .catch((error) => {
        controller.abort(error);
        preparation = null;
        throw error;
      })
      .finally(() => clearTimeout(timeout));
  }
  return preparation;
}
