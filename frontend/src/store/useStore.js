import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  getRandomLocation,
  streamLocationDescription,
  setExplorationPreference,
  deleteExplorationPreference,
  lookupLocation,
  markPrefetchedVisit,
  getLocalizedAddress,
} from "../services/api";
import i18n from "../i18n";
import { PREFETCH_NEXT_ENABLED, PREFETCH_TTL_MS } from "./prefetchConfig";
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

// ===== 预取下一站 =====
// 槽位放在模块作用域，不进 zustand 状态：预取过程中的写入不会触发重渲染，
// 也不会碰到当前地点的讲解。最多一份。
// {
//   location, language, modeKey, createdAt,
//   text, citations, researchStatus, done, error,  // 讲解缓冲区
//   controller,  // 同时控制预取的 /random 和讲解流；接管后成为当前讲解请求的 controller
//   subscriber,  // 接管后把后续片段和收尾推给 store；接管前为 null
// }
const PREFETCH_VIEW = { heading: 0, pitch: 0, fov: 90 };
let prefetchSlot = null;
// 由预取接管讲解的全景。首页 effect 为它请求讲解时直接返回，保证只有一条流；
// 讲解失败后的手动重试、语言变化、换地点或取消都会让它失效。
let prefetchServedDescription = null;

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

// 后端的错误文案只有中文；界面按状态码给出当前语言的提示，原文只进控制台
function locationErrorMessage(resp, kind) {
  if (resp?.status === 429) return i18n.t("error.tooManyRequests");
  if (resp?.status === 0) return resp.error;
  if (resp?.status === 404 && kind === "lookup") {
    return i18n.t("mapPicker.failed");
  }
  return i18n.t(
    kind === "lookup" ? "error.lookupFailed" : "error.locationFailed",
  );
}

// 偏好接口在 200 响应里返回的 error 已按界面语言写好；其他失败用通用提示
function preferenceErrorMessage(resp) {
  if (resp?.status === 200 && resp.error) return resp.error;
  if (resp?.status === 429) return i18n.t("error.tooManyRequests");
  if (resp?.status === 0 && resp.error) return resp.error;
  return i18n.t("error.preferenceFailed");
}

// kind: "random" 随机出发，"lookup" 按坐标找街景
function locationFromResponse(resp, kind, language) {
  if (!resp?.success || !resp.data) {
    if (resp?.error) console.warn("位置请求失败:", resp.status, resp.error);
    throw new Error(locationErrorMessage(resp, kind));
  }
  const latitude = Number(resp.data.latitude);
  const longitude = Number(resp.data.longitude);
  if (isNaN(latitude) || isNaN(longitude)) {
    throw new Error(locationErrorMessage(null, kind));
  }
  // address_language records which language the address fields are in, so a
  // later UI language switch knows to fetch them again.
  return { ...resp.data, latitude, longitude, address_language: language };
}

const ADDRESS_FIELDS = ["formatted_address", "country", "country_code", "city"];

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

// 探索模式加兴趣词；自定义模式还没填兴趣时返回 null，不预取也不使用预取
function explorationModeKey(state) {
  if (state.explorationMode === EXPLORATION_MODES.RANDOM) return "random:";
  if (
    state.explorationMode === EXPLORATION_MODES.CUSTOM &&
    state.explorationInterest
  ) {
    return `custom:${state.explorationInterest}`;
  }
  return null;
}

// 丢弃还没被接管的预取并中止它的请求；已接管的流归当前讲解请求管理
function discardPrefetch() {
  const slot = prefetchSlot;
  prefetchSlot = null;
  if (slot && !slot.subscriber) slot.controller.abort();
}

function isPrefetchCurrent(slot) {
  return prefetchSlot === slot && !slot.controller.signal.aborted;
}

async function runPrefetch(slot) {
  const { signal } = slot.controller;
  try {
    const resp = await getRandomLocation(slot.language, {
      prefetch: true,
      signal,
    });
    if (!isPrefetchCurrent(slot)) return;
    slot.location = locationFromResponse(resp, "random", slot.language);

    const result = await streamLocationDescription(
      slot.location.pano_id,
      slot.language,
      signal,
      PREFETCH_VIEW,
      (delta) => {
        if (signal.aborted) return;
        slot.text += delta;
        slot.subscriber?.({ type: "delta", delta });
      },
    );
    if (signal.aborted) return;
    if (!result.success || !result.data?.description) {
      throw new Error(result.error || "预取讲解失败");
    }
    slot.text = result.data.description;
    slot.citations = result.data.citations || null;
    slot.researchStatus = result.data.research_status || "unverified";
    slot.done = true;
    slot.subscriber?.({ type: "done" });
  } catch (error) {
    if (signal.aborted) return;
    slot.error = error;
    if (slot.subscriber) {
      slot.subscriber({ type: "error", error });
    } else if (prefetchSlot === slot) {
      // 本次不重试，等下一次满足预取条件再试
      console.warn("预取下一站失败:", error);
      prefetchSlot = null;
    }
  }
}

// 取出槽位：有效就交给调用方使用，否则中止并丢弃。取出后槽位总是空的。
function takeUsablePrefetch(state) {
  const slot = prefetchSlot;
  if (!slot) return null;
  const usable =
    Boolean(slot.location?.pano_id) &&
    !slot.error &&
    slot.language === getActiveLanguage() &&
    slot.modeKey === explorationModeKey(state) &&
    Date.now() - slot.createdAt <= PREFETCH_TTL_MS &&
    slot.location.pano_id !== state.location?.pano_id;
  if (!usable) {
    discardPrefetch();
    return null;
  }
  prefetchSlot = null;
  return slot;
}

function reportPrefetchedVisit(panoId) {
  // 不等待结果；失败只记一条警告
  Promise.resolve()
    .then(() => markPrefetchedVisit(panoId))
    .then((resp) => {
      if (!resp?.success) {
        console.warn("补写预取足迹失败:", resp?.error || resp?.status);
      }
    })
    .catch((error) => console.warn("补写预取足迹失败:", error));
}

// 把预取的地点和讲解直接应用到 store；还在生成的讲解流由 store 接管
function applyPrefetchedLocation(slot, set, get) {
  const locationData = slot.location;
  const panoId = locationData.pano_id;
  const language = slot.language;

  // 旧地点的讲解流和重试不能写进新地点；这一步也会清掉旧的接管标记
  get().cancelLocationDescription();
  locationRequestSequence += 1;
  const requestKey = `prefetch:${panoId}:${language}:${++descriptionRequestSequence}`;
  prefetchServedDescription = { panoId, language };

  set({
    ...appliedLocationState(locationData),
    // 与预取讲解使用的画面一致，街景以 0 度初始化
    heading: 0,
    lastRefreshTime: Date.now(),
    description: slot.text || null,
    descriptionCitations: slot.done ? slot.citations : null,
    descriptionResearchStatus: slot.done ? slot.researchStatus : null,
    descriptionError: null,
    isDescriptionLoading: !slot.done,
    descriptionRetries: 0,
    descriptionRequestKey: requestKey,
  });
  reportPrefetchedVisit(panoId);

  if (!slot.done) adoptPrefetchStream(slot, requestKey, set, get);
  return { success: true, data: locationData };
}

// 接管仍在生成的预取讲解：它成为当前的讲解请求，能被 cancelLocationDescription
// 和新的 loadLocationDescription 正常中止；写入前核对请求键、全景和语言。
function adoptPrefetchStream(slot, requestKey, set, get) {
  const panoId = slot.location.pano_id;
  const isCurrent = () =>
    !slot.controller.signal.aborted &&
    get().descriptionRequestKey === requestKey &&
    get().currentLocationRef?.pano_id === panoId &&
    getActiveLanguage() === slot.language;

  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
  }).finally(() => {
    if (activeDescriptionRequest?.requestKey === requestKey) {
      activeDescriptionRequest = null;
    }
  });
  const onAbort = () => finish();
  slot.controller.signal.addEventListener("abort", onAbort, { once: true });

  slot.subscriber = (event) => {
    if (event.type !== "delta") {
      slot.controller.signal.removeEventListener("abort", onAbort);
      finish();
    }
    if (!isCurrent()) return;
    if (event.type === "delta") {
      set((state) => ({
        description: `${state.description || ""}${event.delta}`,
      }));
    } else if (event.type === "done") {
      set({
        description: slot.text,
        descriptionCitations: slot.citations,
        descriptionResearchStatus: slot.researchStatus,
        descriptionError: null,
        isDescriptionLoading: false,
      });
    } else {
      console.error("加载描述失败:", event.error);
      set({
        descriptionCitations: null,
        descriptionResearchStatus: null,
        descriptionError: i18n.t("ai.descriptionFailed"),
        isDescriptionLoading: false,
      });
    }
  };

  activeDescriptionRequest = {
    fingerprint: requestKey,
    requestKey,
    controller: slot.controller,
    promise,
  };
}

const useStore = create(
  devtools(
    (set, get) => ({
      // ===== Location相关状态 =====
      location: null,
      locationError: null,
      isLocationLoading: true,
      isMapLocationLoading: false,
      lastRefreshTime: Date.now() - RATE_LIMIT_MS,
      // 本次会话用户主动点"去探险"或按空格的次数；第一站不预取
      userExploreCount: 0,

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
        const { preserveLocation = false, userInitiated = false } = options;
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

        if (PREFETCH_NEXT_ENABLED) {
          if (userInitiated) {
            set({ userExploreCount: state.userExploreCount + 1 });
          }
          // 手动和语音随机都先看预取；无效或还没取到位置的预取会被中止
          const prefetched = takeUsablePrefetch(state);
          if (prefetched) return applyPrefetchedLocation(prefetched, set, get);
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

          const locationData = locationFromResponse(
            resp,
            "random",
            currentLanguage,
          );
          set(appliedLocationState(locationData));
          return { success: true, data: locationData };
        } catch (error) {
          if (requestId !== locationRequestSequence) {
            return { success: false, superseded: true, error: SUPERSEDED };
          }
          console.error("加载位置失败:", error);
          const message = error.message || i18n.t("error.locationFailed");
          if (!preserveLocation) {
            set({ locationError: message });
          }
          return { success: false, error: message };
        } finally {
          // 已被新请求或直接应用的地点作废时，加载状态归新的那一方管
          if (requestId === locationRequestSequence) {
            set({
              isLocationLoading: false,
              isLoadingLocation: false,
            });
          }
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

          const locationData = locationFromResponse(
            resp,
            "lookup",
            currentLanguage,
          );
          set(appliedLocationState(locationData));
          return { success: true, data: locationData };
        } catch (error) {
          if (requestId !== locationRequestSequence) {
            return { success: false, superseded: true, error: SUPERSEDED };
          }
          console.error("从URL加载位置失败:", error);
          const message = error.message || i18n.t("error.lookupFailed");
          if (!preserveLocation) {
            set({ locationError: message });
          }
          return { success: false, error: message };
        } finally {
          // 已被新请求或直接应用的地点作废时，加载状态归新的那一方管
          if (requestId === locationRequestSequence) {
            set({
              isLocationLoading: false,
              isLoadingLocation: false,
            });
          }
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

          const locationData = locationFromResponse(
            resp,
            "lookup",
            currentLanguage,
          );
          // 点到当前全景附近会找回同一个全景：保持原样，不清空讲解也不重新着陆
          if (locationData.pano_id === get().location?.pano_id) {
            return { success: true, data: get().location, unchanged: true };
          }
          set(appliedLocationState(locationData));

          return {
            success: true,
            data: locationData,
          };
        } catch (error) {
          if (requestId !== locationRequestSequence) {
            return { success: false, superseded: true, error: SUPERSEDED };
          }
          console.error("从地图查找位置失败:", error);
          return {
            success: false,
            error: error.message || i18n.t("error.lookupFailed"),
          };
        } finally {
          if (requestId === locationRequestSequence) {
            set({
              isMapLocationLoading: false,
              isLoadingLocation: false,
            });
          }
        }
      },

      // 语音地点搜索等已拿到结果的导航：直接应用，并让仍在进行的加载作废
      applyNavigatedLocation: (locationData) => {
        locationRequestSequence += 1;
        // 进行中的加载从这一刻起作废，它结束时不会再动加载状态，这里直接收掉
        set({
          isLocationLoading: false,
          isLoadingLocation: false,
          isMapLocationLoading: false,
        });
        // 已经在这个全景：不清空讲解，否则全景没变、讲解也不会重新加载
        if (
          locationData?.pano_id &&
          locationData.pano_id === get().location?.pano_id
        ) {
          return;
        }
        set(
          appliedLocationState({
            address_language: getActiveLanguage(),
            ...locationData,
          }),
        );
      },

      // 切换界面语言后，只把当前地点的地址换成新语言；不换全景、不重新加载讲解
      relocalizeLocationAddress: async () => {
        const location = get().location;
        const language = getActiveLanguage();
        if (!location?.pano_id || location.address_language === language) {
          return;
        }
        const resp = await getLocalizedAddress(
          location.latitude,
          location.longitude,
          language,
        );
        const latest = get().location;
        if (
          !resp.success ||
          latest?.pano_id !== location.pano_id ||
          getActiveLanguage() !== language
        ) {
          return;
        }
        const updated = { ...latest, address_language: language };
        for (const field of ADDRESS_FIELDS) {
          if (resp.data?.[field]) updated[field] = resp.data[field];
        }
        set({ location: updated, currentLocationRef: updated });
      },

      // Description Actions
      loadLocationDescription: (panoId, retryCount = 0) => {
        const MAX_RETRIES = 1;
        const currentLanguage = getActiveLanguage();
        const currentState = get();
        if (prefetchServedDescription) {
          // 讲解由预取提供（已完成或仍在流式追加）时不再发第二个请求；
          // 失败后的重试、换语言、换地点照常请求
          if (
            retryCount === 0 &&
            prefetchServedDescription.panoId === panoId &&
            prefetchServedDescription.language === currentLanguage &&
            !currentState.descriptionError
          ) {
            return activeDescriptionRequest?.promise ?? Promise.resolve();
          }
          prefetchServedDescription = null;
        }
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
        // 只取消当前讲解（包括已接管的预取流），未接管的预取不受影响
        activeDescriptionRequest?.controller.abort();
        activeDescriptionRequest = null;
        prefetchServedDescription = null;
        set({
          isDescriptionLoading: false,
          descriptionRequestKey: null,
        });
      },

      // 首页在讲解状态、位置、浮层或页面可见性变化时调用；满足条件才开始预取
      maybePrefetchNext: ({ overlayOpen = false } = {}) => {
        if (!PREFETCH_NEXT_ENABLED) return false;
        if (
          prefetchSlot &&
          Date.now() - prefetchSlot.createdAt > PREFETCH_TTL_MS
        ) {
          discardPrefetch();
        }
        if (prefetchSlot) return false;

        const state = get();
        const modeKey = explorationModeKey(state);
        const descriptionFinished =
          !state.isDescriptionLoading &&
          descriptionRetryTimer === null &&
          Boolean(state.description || state.descriptionError);
        if (
          state.userExploreCount < 1 ||
          overlayOpen ||
          (typeof document !== "undefined" &&
            document.visibilityState === "hidden") ||
          !state.isExplorationInitialized ||
          state.isSavingPreference ||
          state.isLoadingLocation ||
          !modeKey ||
          !state.location?.pano_id ||
          !descriptionFinished
        ) {
          return false;
        }

        const slot = {
          location: null,
          language: getActiveLanguage(),
          modeKey,
          createdAt: Date.now(),
          text: "",
          citations: null,
          researchStatus: null,
          done: false,
          error: null,
          controller: new AbortController(),
          subscriber: null,
        };
        prefetchSlot = slot;
        runPrefetch(slot);
        return true;
      },

      // 离开首页时中止进行中的预取；已经完整取好的预取保留，回来后 15 分钟内仍可用
      stopPrefetch: () => {
        if (prefetchSlot && !prefetchSlot.done) discardPrefetch();
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
              throw new Error(preferenceErrorMessage(response));
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
              throw new Error(preferenceErrorMessage(response));
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
          set({ preferenceError: getRateLimitMessage() });
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
            throw new Error(preferenceErrorMessage(resp));
          }
        } catch (error) {
          console.error("保存探索偏好失败:", error);
          set({
            preferenceError: error.message || i18n.t("error.preferenceFailed"),
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

if (PREFETCH_NEXT_ENABLED) {
  // 探索模式或兴趣变化（包括语音工具直接改 store）后，预取的地点不再符合偏好
  useStore.subscribe((state, prevState) => {
    if (
      state.explorationMode !== prevState.explorationMode ||
      state.explorationInterest !== prevState.explorationInterest
    ) {
      discardPrefetch();
    }
  });
  // 界面语言变化后，预取的讲解语言不再匹配
  i18n.on?.("languageChanged", () => discardPrefetch());
}

export default useStore;
