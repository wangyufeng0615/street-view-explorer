// 首页"预取下一站"开关。设为 false 时首页探索完全走原来的按需加载路径。
export const PREFETCH_NEXT_ENABLED = true;

// 与后端记录预取全景的有效期一致，超时的预取不再使用
export const PREFETCH_TTL_MS = 15 * 60 * 1000;
