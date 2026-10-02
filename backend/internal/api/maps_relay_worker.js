// Resolve the requesting page on each fetch so worker restarts and other tabs
// cannot inherit the experiment. Never cache SDK/image bodies in CacheStorage.
const hosts = new Set(__MAPS_RELAY_HOSTS__);
const enabled = __MAPS_RELAY_ENABLED__;
const optedIn = (client) => client && new URL(client.url).searchParams.get("mapsRelay") === "1";
const isGoogle = (host) => ["googleapis.com", "gstatic.com", "googleusercontent.com", "ggpht.com", "google.com"].some((domain) => host === domain || host.endsWith("." + domain));
async function releaseIfUnused() {
  const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (!enabled || !pages.some(optedIn)) await self.registration.unregister();
}
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  await self.clients.claim();
  await releaseIfUnused();
})()));
self.addEventListener("message", (event) => {
  if (event.data?.type === "maps-relay-claim") event.waitUntil(self.clients.claim());
  if (event.data?.type === "maps-relay-release") event.waitUntil(releaseIfUnused());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!isGoogle(url.hostname)) return;
  event.respondWith((async () => {
    const client = await self.clients.get(event.clientId);
    // Missing client context must never silently permit a direct Google call.
    if (!client || (client.type && client.type !== "window")) return new Response("Maps relay client unavailable", { status: 503 });
    if (!optedIn(client)) return fetch(event.request);
    if (!enabled) return new Response("Maps relay disabled", { status: 503 });
    if (url.protocol !== "https:" || !hosts.has(url.host)) {
      // Only the hostname is diagnostic; URLs can contain nested Google keys.
      client.postMessage({ type: "maps-relay-blocked-host", host: url.host });
      return new Response("Maps relay host not supported", { status: 502 });
    }
    const headers = new Headers();
    for (const [name, value] of event.request.headers) {
      if (name.startsWith("x-goog-") || ["accept", "accept-language", "content-type", "x-user-agent", "x-client-data"].includes(name)) headers.set(name, value);
    }
    headers.set("X-Maps-Relay", "1");
    const options = { method: event.request.method, headers, credentials: "same-origin", mode: "same-origin", cache: event.request.cache, redirect: "error", signal: event.request.signal, referrer: event.request.referrer || client.url, referrerPolicy: event.request.referrerPolicy };
    if (event.request.method === "POST") options.body = await event.request.clone().arrayBuffer();
    const target = self.location.origin + "/api/v1/maps-relay/resource/" + url.host + url.pathname + url.search;
    try {
      return await fetch(target, options);
    } catch {
      return new Response("Maps relay unavailable", { status: 502 });
    }
  })());
});
