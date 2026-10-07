import { useSyncExternalStore } from "react";

// 这个浏览器能不能用 Google 地图（街景和小地图共用一份脚本）：
// unknown 还在加载；ok 已加载；unreachable 连不上 Google（脚本报错、超时，或 8 秒还没加载好）；
// unavailable Google 拒绝了我们的密钥或额度（gm_authFailure）。
// 连不上之后再加载成功会回到 ok；密钥出错改网络也没用，不再改回去。
let state = "unknown";
const listeners = new Set();

export function getMapsReachability() {
  return state;
}

export function setMapsReachability(next) {
  if (state === next || state === "unavailable") return;
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribeMapsReachability(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMapsReachability() {
  return useSyncExternalStore(
    subscribeMapsReachability,
    getMapsReachability,
    getMapsReachability,
  );
}

export function resetMapsReachabilityForTests() {
  state = "unknown";
  listeners.clear();
}
