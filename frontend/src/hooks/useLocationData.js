import { useRef, useCallback } from "react";
import useStore from "../store/useStore";

export default function useLocationData() {
  // 从Zustand store获取状态和actions
  const location = useStore((state) => state.location);
  const error = useStore((state) => state.locationError);
  const isLoading = useStore((state) => state.isLocationLoading);
  const loadRandomLocationFromStore = useStore(
    (state) => state.loadRandomLocation,
  );
  const lastRefreshTime = useStore((state) => state.lastRefreshTime);
  const isLoadingLocation = useStore((state) => state.isLoadingLocation);

  // 保持refs以保证向后兼容
  const loadingRef = useRef(false);
  const lastRefreshTimeRef = useRef(Date.now() - 1000);

  // 包装store的loadRandomLocation以保持兼容性
  const loadRandomLocation = useCallback(
    async (skipRateLimit = false, options = undefined) => {
      // 同步ref状态
      loadingRef.current = isLoadingLocation;
      lastRefreshTimeRef.current = lastRefreshTime;

      // 调用store的方法
      await loadRandomLocationFromStore(skipRateLimit, options);
    },
    [loadRandomLocationFromStore, isLoadingLocation, lastRefreshTime],
  );

  return {
    location,
    error,
    isLoading,
    loadRandomLocation,
    loadingRef,
    lastRefreshTimeRef,
  };
}
