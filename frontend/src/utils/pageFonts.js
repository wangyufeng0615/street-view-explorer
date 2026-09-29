// 只有猜地理和在线对战的标题用到 Noto Serif SC；它的字体 CSS 很大，
// 不放进 index.html，由这两个页面挂载时按需注入，并按 id 去重。
const NOTO_SERIF_SC_LINK_ID = "noto-serif-sc-font";
const NOTO_SERIF_SC_HREF =
  "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600&display=swap";

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
