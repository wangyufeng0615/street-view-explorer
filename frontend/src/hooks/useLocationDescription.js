import { useRef, useCallback, useEffect } from "react";
import useStore from "../store/useStore";

export default function useLocationDescription() {
  // 从Zustand store获取状态和actions
  const description = useStore((state) => state.description);
  const descriptionCitations = useStore((state) => state.descriptionCitations);
  const descriptionResearchStatus = useStore(
    (state) => state.descriptionResearchStatus,
  );
  const isLoadingDesc = useStore((state) => state.isDescriptionLoading);
  const descError = useStore((state) => state.descriptionError);
  const descRetries = useStore((state) => state.descriptionRetries);
  const loadLocationDescriptionFromStore = useStore(
    (state) => state.loadLocationDescription,
  );
  const cancelLocationDescription = useStore(
    (state) => state.cancelLocationDescription,
  );
  const setNetworkState = useStore((state) => state.setNetworkState);
  const networkState = useStore((state) => state.networkState);
  const currentLocationRef = useStore((state) => state.currentLocationRef);

  // 首页在 effect 里读取这两个 ref，避免因状态变化重新订阅
  const locationRef = useRef(null);
  const networkStateRef = useRef(navigator.onLine);

  // 同步store状态到refs
  useEffect(() => {
    locationRef.current = currentLocationRef;
    networkStateRef.current = networkState;
  }, [currentLocationRef, networkState]);

  // 包装store的loadLocationDescription
  const loadLocationDescription = useCallback(
    (panoId) => {
      // 调用store的方法
      loadLocationDescriptionFromStore(panoId);
    },
    [loadLocationDescriptionFromStore],
  );

  // 监听网络状态
  useEffect(() => {
    const handleOnline = () => {
      setNetworkState(true);
      networkStateRef.current = true;
    };

    const handleOffline = () => {
      setNetworkState(false);
      networkStateRef.current = false;
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setNetworkState]);

  // 组件卸载时清理资源
  useEffect(() => cancelLocationDescription, [cancelLocationDescription]);

  return {
    description,
    descriptionCitations,
    descriptionResearchStatus,
    isLoadingDesc,
    descError,
    descRetries,
    loadLocationDescription,
    locationRef,
    networkStateRef,
  };
}
