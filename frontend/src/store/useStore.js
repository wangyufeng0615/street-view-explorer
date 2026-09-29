import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  getRandomLocation,
  streamLocationDescription,
  setExplorationPreference,
  deleteExplorationPreference,
  lookupLocation,
} from "../services/api";
import i18n from "../i18n";
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "../utils/safeStorage";

const RATE_LIMIT_MS = 1000; // 1秒限制
const EXPLORATION_MODE_KEY = "exploration_mode";
const EXPLORATION_INTEREST_KEY = "exploration_interest";
let activeDescriptionRequest = null;
let descriptionRetryTimer = null;
let descriptionRequestSequence = 0;
let toastHideTimer = null;
let preferenceInitialization = null;
// 每次位置加载或直接应用新位置都会递增；过期的加载结果不再写入 store
let locationRequestSequence = 0;
const SUPERSEDED = "位置已被新的请求替换";

// 清空当前位置时一并清掉讲解和视角，避免旧地点内容残留
const CLEARED_LOCATION_STATE = {
  location: null,
  description: null,
  descriptionCitations: null,
  descriptionResearchStatus: null,
  descriptionError: null,
  streetViewView: null,
};

function getActiveLanguage() {
  const language = i18n.resolvedLanguage || i18n.language || "en";
  return language.startsWith("zh") ? "zh" : "en";
}

function getRateLimitMessage() {
  return getActiveLanguage() === "zh"
    ? "操作太快了，请稍等一秒再试"
    : "Too fast. Please wait a second and try again";
}

function locationFromResponse(resp, fallbackError) {
  if (!resp?.success || !resp.data) {
    throw new Error(resp?.error || fallbackError);
  }
  const latitude = Number(resp.data.latitude);
  const longitude = Number(resp.data.longitude);
  if (isNaN(latitude) || isNaN(longitude)) {
    throw new Error("无效的坐标数据");
  }
  return { ...resp.data, latitude, longitude };
}

function appliedLocationState(locationData) {
  return {
    ...CLEARED_LOCATION_STATE,
    location: locationData,
    currentLocationRef: locationData,
    locationError: null,
  };
}

export const EXPLORATION_MODES = {
  RANDOM: "random",
  CUSTOM: "custom",
};

const useStore = create(
  devtools(
    (set, get) => ({
      // ===== Location相关状态 =====
      location: null,
      locationError: null,
      isLocationLoading: true,
      isMapLocationLoading: false,
      lastRefreshTime: Date.now() - RATE_LIMIT_MS,

      // ===== Description相关状态 =====
      description: null,
      descriptionCitations: null,
      descriptionResearchStatus: null,
      descriptionError: null,
      isDescriptionLoading: false,
      descriptionRetries: 0,
      descriptionRequestKey: null,

      // ===== Exploration Mode相关状态 =====
      explorationMode: EXPLORATION_MODES.RANDOM,
      explorationInterest: "",
      isSavingPreference: false,
      preferenceError: null,
      isExplorationInitialized: false,

      // ===== UI相关状态 =====
      heading: 0,
      streetViewView: null,
      scale: 1,
      toastMessage: "",
      showToast: false,

      // ===== Refs (作为状态管理) =====
      isLoadingLocation: false,
      currentLocationRef: null,
      networkState: true,

      // ===== Actions =====

      // Location Actions
      loadRandomLocation: async (skipRateLimit = false, options = {}) => {
        const { preserveLocation = false } = options;
        if (!get().isExplorationInitialized) {
          await get().initializeExplorationMode();
          if (!get().isExplorationInitialized) {
            return {
              success: false,
              error: get().preferenceError || "同步探索偏好失败",
            };
          }
        }
        const state = get();

        // 检查限流：只提示，不把整页切成错误页
        if (!skipRateLimit) {
          const now = Date.now();
          const timeSinceLastRefresh = now - state.lastRefreshTime;
          if (timeSinceLastRefresh < RATE_LIMIT_MS) {
            const message = getRateLimitMessage();
            get().showToastMessage(message);
            return { success: false, error: message, rateLimited: true };
          }
        }

        // 检查是否正在加载
        if (state.isLoadingLocation) {
          return { success: false, error: i18n.t("mapPicker.busy") };
        }

        const requestId = ++locationRequestSequence;
        if (!preserveLocation) {
          // 旧地点的讲解流不能写进正在加载的新位置
          get().cancelLocationDescription();
        }
        set({
          isLoadingLocation: true,
          isLocationLoading: true,
          lastRefreshTime: Date.now(),
          ...(preserveLocation ? {} : CLEARED_LOCATION_STATE),
        });

        try {
          const currentLanguage = getActiveLanguage();
          const resp = await getRandomLocation(currentLanguage);
          if (requestId !== locationRequestSequence) {
            return { success: false, superseded: true, error: SUPERSEDED };
          }

          const locationData = locationFromResponse(resp, "获取位置失败");
          set(appliedLocationState(locationData));
          return { success: true, data: locationData };
        } catch (error) {
          if (requestId !== locationRequestSequence) {
            return { success: false, superseded: true, error: SUPERSEDED };
          }
          console.error("加载位置失败:", error);
          const message = error.message || "获取位置失败，请重试";
          if (!preserveLocation) {
            set({ locationError: message });
          }
          return { success: false, error: message };
        } finally {
          set({
            isLocationLoading: false,
            isLoadingLocation: false,
          });
        }
      },

      // URL Location Actions
      loadLocationFromURL: async (lat, lng, options = {}) => {
        const { preserveLocation = false, source = "shared" } = options;
        const state = get();
        if (state.isLoadingLocation) {
          return { success: false, error: i18n.t("mapPicker.busy") };
        }

        const requestId = ++locationRequestSequence;
        if (!preserveLocation) {
          get().cancelLocationDescription();
        }
        set({
          isLoadingLocation: true,
          isLocationLoading: true,
          ...(preserveLocation ? {} : CLEARED_LOCATION_STATE),
        });

        try {
          const currentLanguage = getActiveLanguage();
          const resp = await lookupLocation(lat, lng, currentLanguage, source);
          if (requestId !== locationRequestSequence) {
            return { success: false, superseded: true, error: SUPERSEDED };
          }

          const locationData = locationFromResponse(resp, "查找位置失败");
          set(appliedLocationState(locationData));
          return { success: true, data: locationData };
        } catch (error) {
          if (requestId !== locationRequestSequence) {
            return { success: false, superseded: true, error: SUPERSEDED };
          }
          console.error("从URL加载位置失败:", error);
          const message = error.message || "查找位置失败，请重试";
          if (!preserveLocation) {
            set({ locationError: message });
          }
          return { success: false, error: message };
        } finally {
          set({
            isLocationLoading: false,
            isLoadingLocation: false,
          });
        }
      },

      // Map pick Location Actions
      loadLocationFromMapPick: async (lat, lng) => {
        const state = get();
        if (state.isLoadingLocation) {
          return {
            success: false,
            error: i18n.t("mapPicker.busy"),
          };
        }

        const requestId = ++locationRequestSequence;
        set({
          isLoadingLocation: true,
          isMapLocationLoading: true,
        });

        try {
          const currentLanguage = getActiveLanguage();
          const resp = await lookupLocation(
            lat,
            lng,
            currentLanguage,
            "map_pick",
            "nearest",
          );
          if (requestId !== locationRequestSequence) {
            return { success: false, superseded: true, error: SUPERSEDED };
          }

          const locationData = locationFromResponse(resp, "查找位置失败");
          set(appliedLocationState(locationData));

          return {
            success: true,
            data: locationData,
          };
        } catch (error) {
          console.error("从地图查找位置失败:", error);
          return {
            success: false,
            error: error.message || "查找位置失败，请重试",
          };
        } finally {
          set({
            isMapLocationLoading: false,
            isLoadingLocation: false,
          });
        }
      },

      // 语音地点搜索等已拿到结果的导航：直接应用，并让仍在进行的加载作废
      applyNavigatedLocation: (locationData) => {
        locationRequestSequence += 1;
        set(appliedLocationState(locationData));
      },

      // Description Actions
      loadLocationDescription: (panoId, retryCount = 0) => {
        const MAX_RETRIES = 1;
        const currentLanguage = getActiveLanguage();
        const currentState = get();
        const currentView =
          currentState.streetViewView?.panoId === panoId
            ? currentState.streetViewView
            : { heading: currentState.heading, pitch: 0, fov: 90 };
        const fingerprint = [
          panoId,
          currentLanguage,
          currentView?.panoId || "",
          Math.round(Number(currentView?.heading) || 0),
          Math.round(Number(currentView?.pitch) || 0),
          Math.round(Number(currentView?.fov) || 90),
          retryCount,
        ].join(":");

        if (activeDescriptionRequest?.fingerprint === fingerprint) {
          return activeDescriptionRequest.promise;
        }
        clearTimeout(descriptionRetryTimer);
        descriptionRetryTimer = null;
        activeDescriptionRequest?.controller.abort();

        const controller = new AbortController();
        const requestKey = `${fingerprint}:${++descriptionRequestSequence}`;
        const startedAt = Date.now();
        let receivedText = false;

        set({
          isDescriptionLoading: true,
          description: null,
          descriptionCitations: null,
          descriptionResearchStatus: null,
          descriptionError: null,
          descriptionRetries: retryCount,
          descriptionRequestKey: requestKey,
        });

        const promise = (async () => {
          try {
            const resp = await streamLocationDescription(
              panoId,
              currentLanguage,
              controller.signal,
              currentView,
              (delta) => {
                if (controller.signal.aborted) return;
                const latestState = get();
                if (
                  latestState.descriptionRequestKey === requestKey &&
                  latestState.currentLocationRef?.pano_id === panoId &&
                  getActiveLanguage() === currentLanguage
                ) {
                  receivedText ||= Boolean(delta.trim());
                  set((state) => ({
                    description: `${state.description || ""}${delta}`,
                  }));
                }
              },
            );
            const latestState = get();

            if (
              controller.signal.aborted ||
              latestState.descriptionRequestKey !== requestKey ||
              latestState.currentLocationRef?.pano_id !== panoId ||
              getActiveLanguage() !== currentLanguage
            ) {
              return;
            }

            if (resp.success && resp.data?.description) {
              set({
                description: resp.data.description,
                descriptionCitations: resp.data.citations || null,
                descriptionResearchStatus:
                  resp.data.research_status || "unverified",
                descriptionError: null,
              });
            } else if (!controller.signal.aborted) {
              const error = new Error(resp.error || "获取描述失败");
              if (resp.aborted) error.name = "AbortError";
              throw error;
            }
          } catch (error) {
            if (
              controller.signal.aborted ||
              get().descriptionRequestKey !== requestKey ||
              get().currentLocationRef?.pano_id !== panoId ||
              getActiveLanguage() !== currentLanguage
            ) {
              return;
            }

            console.error("加载描述失败:", error);
            set({
              descriptionCitations: null,
              descriptionResearchStatus: null,
            });

            // Retry a quick failure once, but never restart a slow or partial answer.
            if (
              retryCount < MAX_RETRIES &&
              get().networkState &&
              !receivedText &&
              error.name !== "AbortError" &&
              Date.now() - startedAt < 5000
            ) {
              descriptionRetryTimer = setTimeout(() => {
                descriptionRetryTimer = null;
                const state = get();
                if (
                  state.descriptionRequestKey === requestKey &&
                  state.currentLocationRef?.pano_id === panoId &&
                  getActiveLanguage() === currentLanguage
                ) {
                  if (state.networkState) {
                    state.loadLocationDescription(panoId, retryCount + 1);
                  } else {
                    set({ descriptionError: i18n.t("ai.descriptionFailed") });
                  }
                }
              }, 1000);
            } else {
              set({ descriptionError: i18n.t("ai.descriptionFailed") });
            }
          } finally {
            if (activeDescriptionRequest?.requestKey === requestKey) {
              activeDescriptionRequest = null;
            }
            if (get().descriptionRequestKey === requestKey) {
              set({ isDescriptionLoading: false });
            }
          }
        })();

        activeDescriptionRequest = {
          fingerprint,
          requestKey,
          controller,
          promise,
        };
        return promise;
      },

      cancelLocationDescription: () => {
        clearTimeout(descriptionRetryTimer);
        descriptionRetryTimer = null;
        activeDescriptionRequest?.controller.abort();
        activeDescriptionRequest = null;
        set({
          isDescriptionLoading: false,
          descriptionRequestKey: null,
        });
      },

      // Exploration Mode Actions
      initializeExplorationMode: () => {
        if (preferenceInitialization) return preferenceInitialization;
        const savedMode = readLocalStorage(EXPLORATION_MODE_KEY);
        const savedInterest = readLocalStorage(EXPLORATION_INTEREST_KEY) || "";
        const custom =
          savedMode === EXPLORATION_MODES.CUSTOM && Boolean(savedInterest);
        // 后端只在设置兴趣成功后才有偏好，前端随后写入本地兴趣；本地完全没有
        // 兴趣记录时后端也没有偏好，首屏不必等删除请求。本地记录残缺时仍先清理。
        if (savedMode !== EXPLORATION_MODES.CUSTOM && !savedInterest) {
          set({
            explorationMode: EXPLORATION_MODES.RANDOM,
            explorationInterest: "",
            isExplorationInitialized: true,
            preferenceError: null,
            locationError: null,
          });
          return Promise.resolve();
        }
        set({ isSavingPreference: true, preferenceError: null });
        preferenceInitialization = (async () => {
          try {
            const response = custom
              ? await setExplorationPreference(savedInterest)
              : await deleteExplorationPreference();
            if (!response.success)
              throw new Error(response.error || "同步探索偏好失败");
            set({
              explorationMode: custom
                ? EXPLORATION_MODES.CUSTOM
                : EXPLORATION_MODES.RANDOM,
              explorationInterest: custom ? savedInterest : "",
              isExplorationInitialized: true,
              locationError: null,
            });
          } catch (error) {
            set({
              preferenceError: error.message,
              locationError: error.message,
              isLocationLoading: false,
            });
          } finally {
            set({ isSavingPreference: false });
            preferenceInitialization = null;
          }
        })();
        return preferenceInitialization;
      },

      handleModeChange: async (mode) => {
        if (get().isSavingPreference || get().isLoadingLocation) return;
        if (mode === EXPLORATION_MODES.RANDOM) {
          set({ isSavingPreference: true, preferenceError: null });
          try {
            const response = await deleteExplorationPreference();
            if (!response.success)
              throw new Error(response.error || "删除探索偏好失败");
            writeLocalStorage(EXPLORATION_MODE_KEY, EXPLORATION_MODES.RANDOM);
            removeLocalStorage(EXPLORATION_INTEREST_KEY);
            set({
              explorationMode: EXPLORATION_MODES.RANDOM,
              explorationInterest: "",
              isExplorationInitialized: true,
            });
            await get().loadRandomLocation(true);
          } catch (error) {
            set({ preferenceError: error.message });
            get().showToastMessage(error.message);
          } finally {
            set({ isSavingPreference: false });
          }
        } else if (mode === EXPLORATION_MODES.CUSTOM) {
          set({ explorationMode: EXPLORATION_MODES.CUSTOM });
        }
      },

      handlePreferenceChange: async (interest) => {
        const state = get();
        const now = Date.now();

        // 检查限流
        if (now - state.lastRefreshTime < RATE_LIMIT_MS) {
          const waitTime = Math.ceil(
            (RATE_LIMIT_MS - (now - state.lastRefreshTime)) / 1000,
          );
          set({ preferenceError: `请等待 ${waitTime} 秒后再试` });
          return;
        }

        if (state.isSavingPreference || state.isLoadingLocation) return;

        set({
          isSavingPreference: true,
          preferenceError: null,
          lastRefreshTime: now,
        });

        try {
          const resp = await setExplorationPreference(interest, false);

          if (resp.success) {
            writeLocalStorage(EXPLORATION_MODE_KEY, EXPLORATION_MODES.CUSTOM);
            writeLocalStorage(EXPLORATION_INTEREST_KEY, interest);

            set({
              explorationMode: EXPLORATION_MODES.CUSTOM,
              explorationInterest: interest,
              preferenceError: null,
            });

            // 自动刷新位置
            get().loadRandomLocation(true);
          } else {
            throw new Error(resp.error || "保存失败");
          }
        } catch (error) {
          console.error("保存探索偏好失败:", error);
          set({
            preferenceError: error.message || "保存失败，请重试",
          });
        } finally {
          set({ isSavingPreference: false });
        }
      },

      // UI Actions
      setHeading: (heading) => {
        const numericHeading = Number(heading);
        if (!Number.isFinite(numericHeading)) return;

        const normalizedHeading =
          ((Math.round(numericHeading) % 360) + 360) % 360;
        if (get().heading !== normalizedHeading) {
          set({ heading: normalizedHeading });
        }
      },

      setStreetViewView: (nextView) => {
        if (!nextView?.panoId) return;
        const normalized = {
          panoId: String(nextView.panoId),
          latitude: Number(nextView.latitude),
          longitude: Number(nextView.longitude),
          heading: Math.round(Number(nextView.heading) || 0),
          pitch: Math.round(Number(nextView.pitch) || 0),
          zoom: Number(nextView.zoom) || 1,
          fov: Math.round(Number(nextView.fov) || 90),
          source: nextView.source || "initial",
        };
        const current = get().streetViewView;
        if (
          current?.panoId === normalized.panoId &&
          current.heading === normalized.heading &&
          current.pitch === normalized.pitch &&
          current.fov === normalized.fov &&
          current.source === normalized.source
        ) {
          return;
        }
        set({ streetViewView: normalized });
      },
      setScale: (scale) => set({ scale }),

      showToastMessage: (message) => {
        if (toastHideTimer !== null) {
          clearTimeout(toastHideTimer);
        }
        set({
          toastMessage: message,
          showToast: true,
        });

        // 3秒后自动隐藏
        toastHideTimer = setTimeout(() => {
          set({ showToast: false });
          toastHideTimer = null;
        }, 3000);
      },

      // Network State Actions
      setNetworkState: (state) => set({ networkState: state }),

      // Reset Actions
      resetLocationError: () => set({ locationError: null }),
      resetDescriptionError: () => set({ descriptionError: null }),
    }),
    {
      name: "streetview-store",
    },
  ),
);

export default useStore;
