import { useEffect } from "react";

export default function useKeyboardNavigation(
  loadRandomLocation,
  isLoading,
  loadingRef,
) {
  // 监听空格键
  useEffect(() => {
    const handleKeyPress = (event) => {
      // 如果当前焦点在输入框或文本框上，不触发空格键探索
      if (
        event.defaultPrevented ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        event.target.closest?.(
          'input, textarea, select, button, a, [contenteditable="true"], [role="button"]',
        )
      ) {
        return;
      }

      if (event.code !== "Space") return;
      // 按住空格的自动重复不算新的一次出发，否则加载一结束就会接连跳站
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      if (!isLoading && !loadingRef.current) {
        event.preventDefault();
        loadRandomLocation();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [isLoading, loadRandomLocation, loadingRef]);
}
