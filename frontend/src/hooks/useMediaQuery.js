import { useEffect, useState } from "react";

function matches(query) {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches);
}

// 跟随媒体查询的结果；屏幕旋转、拖窗口跨过断点时更新
export default function useMediaQuery(query) {
  const [isMatch, setIsMatch] = useState(() => matches(query));

  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setIsMatch(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);

  return isMatch;
}
