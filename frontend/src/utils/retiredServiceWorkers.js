// 地图中继试验（2026-10 下线）在打开过试验链接的浏览器里注册了作用于整站的
// Service Worker。它不会自己注销，留着会让每个地图请求多绕一道，地图在后台线程里
// 发的请求还会被它拒掉；启动时把它清掉。
const RETIRED_WORKER_PATH = "/api/v1/maps-relay/";

export function unregisterRetiredServiceWorkers() {
  const workers =
    typeof navigator === "undefined" ? null : navigator.serviceWorker;
  if (!workers?.getRegistrations) return Promise.resolve();
  return workers
    .getRegistrations()
    .then((registrations) =>
      Promise.all(
        registrations
          .filter((registration) => {
            const worker =
              registration.active ||
              registration.waiting ||
              registration.installing;
            return worker?.scriptURL.includes(RETIRED_WORKER_PATH);
          })
          .map((registration) => registration.unregister()),
      ),
    )
    .catch(() => undefined);
}
