// @ts-check
import COVER_PLACES from "../data/coverPlaces";

// 首页封面每个标签页只出现一次；sessionStorage 不可用时退化为每次加载都出现
const COVER_SEEN_KEY = "atlasCoverSeen";

// 图片按一年强缓存；重新生成封面图（scripts/build_cover_images.py）后递增这个版本号
export const COVER_IMAGE_VERSION = "1";

/** @typedef {{ id: string, zh: string, en: string, lat: number, lng: number, posMobile?: string }} CoverPlace */

/** @returns {Storage | null} */
function getSessionStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage || null : null;
  } catch {
    return null;
  }
}

/**
 * 只在首次进入首页时显示封面：带坐标的分享链接直接看街景，同一标签页里看过一次就不再显示。
 * @param {{ search?: string, storage?: Storage | null }} [options]
 */
export function shouldShowCover({
  search = typeof window !== "undefined" ? window.location.search : "",
  storage = getSessionStorage(),
} = {}) {
  const params = new URLSearchParams(search);
  if (params.has("lat") && params.has("lng")) return false;
  try {
    return storage?.getItem(COVER_SEEN_KEY) !== "1";
  } catch {
    return true;
  }
}

/** @param {Storage | null} [storage] */
export function markCoverSeen(storage = getSessionStorage()) {
  try {
    storage?.setItem(COVER_SEEN_KEY, "1");
  } catch {
    // 写不进去只影响下次刷新是否再显示
  }
}

/**
 * 每次随机挑一张封面图。
 * @param {() => number} [random]
 * @returns {CoverPlace}
 */
export function pickCoverPlace(random = Math.random) {
  const index = Math.min(
    COVER_PLACES.length - 1,
    Math.floor(random() * COVER_PLACES.length),
  );
  return COVER_PLACES[index];
}

/** @type {CoverPlace | null} */
let placeForThisVisit = null;

/**
 * 同一次页面加载只挑一张：React 开发模式会把状态初始化执行两次，
 * 首页离开再回来也沿用同一张，不会多下载一张图。
 * @param {() => number} [random]
 */
export function coverPlaceForThisVisit(random = Math.random) {
  if (!placeForThisVisit) placeForThisVisit = pickCoverPlace(random);
  return placeForThisVisit;
}

/** @param {string} id */
export function coverImageUrl(id) {
  const base = import.meta.env?.BASE_URL || "/";
  return `${base}cover/${id}.webp?v=${COVER_IMAGE_VERSION}`;
}

const preloaded = new Set();

/**
 * 决定显示封面后立刻开始下载这张图，不等封面组件挂载。
 * @param {CoverPlace} place
 */
export function preloadCoverImage(place) {
  if (preloaded.has(place.id)) return;
  preloaded.add(place.id);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = coverImageUrl(place.id);
  } catch {
    // 预加载失败不影响封面自己加载
  }
}

/**
 * @param {number} lat
 * @param {number} lng
 */
export function formatCoverCoord(lat, lng) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lng).toFixed(2)}°${ew}`;
}
