// Noto Serif SC 是全站唯一的衬线体：首页 Atlas 来信、Odyssey 和来信页、猜地理和在线对战的标题；它的字体 CSS 很大，
// 不放进 index.html，由这些页面挂载时按需注入（不阻塞首屏），并按 id 去重。
// 只取 400 和 600 两档：每多一档字重，字体 CSS 和要下载的字形分片都会多一份；更粗的标题会落到 600。
const NOTO_SERIF_SC_LINK_ID = "noto-serif-sc-font";
const NOTO_SERIF_SC_HREF =
  "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&display=swap";

export function loadNotoSerifSC() {
  if (typeof document === "undefined") return;
  // 与 index.html 一致：本地开发的浏览器出网走代理，不直连外部字体，CSS 里有衬线后备字体
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return;
  if (document.getElementById(NOTO_SERIF_SC_LINK_ID)) return;

  const link = document.createElement("link");
  link.id = NOTO_SERIF_SC_LINK_ID;
  link.rel = "stylesheet";
  link.href = NOTO_SERIF_SC_HREF;
  document.head.appendChild(link);
}
