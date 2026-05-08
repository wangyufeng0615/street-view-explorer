import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
    getRandomLocation,
    getLocationDescription,
    setExplorationPreference,
    deleteExplorationPreference,
    lookupLocation,
} from '../services/api';
import i18n from '../i18n';

const RATE_LIMIT_MS = 1000; // 1秒限制
const EXPLORATION_MODE_KEY = 'exploration_mode';
const EXPLORATION_INTEREST_KEY = 'exploration_interest';

function getActiveLanguage() {
    const language = i18n.resolvedLanguage || i18n.language || 'en';
    return language.startsWith('zh') ? 'zh' : 'en';
}

export const EXPLORATION_MODES = {
    RANDOM: 'random',
    CUSTOM: 'custom'
};

const useStore = create(
    devtools(
        (set, get) => ({
            // ===== Location相关状态 =====
            location: null,
            locationError: null,
            isLocationLoading: true,
            lastRefreshTime: Date.now() - RATE_LIMIT_MS,

            // ===== Description相关状态 =====
            description: null,
            descriptionCitations: null,
            descriptionError: null,
            isDescriptionLoading: false,
            descriptionRetries: 0,
            descriptionRequestKey: null,

            // ===== Exploration Mode相关状态 =====
            explorationMode: EXPLORATION_MODES.RANDOM,
            explorationInterest: '',
            isSavingPreference: false,
            preferenceError: null,
            isExplorationInitialized: false,

            // ===== UI相关状态 =====
            heading: 0,
            scale: 1,
            toastMessage: '',
            showToast: false,

            // ===== Refs (作为状态管理) =====
            isLoadingLocation: false,
            currentLocationRef: null,
            networkState: true,

            // ===== Actions =====

            // Location Actions
            loadRandomLocation: async (skipRateLimit = false) => {
                const state = get();

                // 检查限流
                if (!skipRateLimit) {
                    const now = Date.now();
                    const timeSinceLastRefresh = now - state.lastRefreshTime;
                    if (timeSinceLastRefresh < RATE_LIMIT_MS) {
                        const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRefresh) / 1000);
                        set({ locationError: `请等待 ${waitTime} 秒后再试` });
                        return;
                    }
                }

                // 检查是否正在加载
                if (state.isLoadingLocation) return;

                // 更新状态
                set({
                    isLoadingLocation: true,
                    isLocationLoading: true,
                    lastRefreshTime: Date.now(),
                    location: null,
                    description: null,
                    descriptionError: null
                });

                try {
                    const currentLanguage = getActiveLanguage();
                    const resp = await getRandomLocation(currentLanguage);

                    // 检查是否仍在加载状态
                    if (!get().isLoadingLocation) return;

                    if (resp.success && resp.data) {
                        const lat = Number(resp.data.latitude);
                        const lng = Number(resp.data.longitude);

                        if (!isNaN(lat) && !isNaN(lng)) {
                            const locationData = {
                                ...resp.data,
                                latitude: lat,
                                longitude: lng
                            };

                            set({
                                location: locationData,
                                currentLocationRef: locationData,
                                locationError: null
                            });
                        } else {
                            throw new Error('无效的坐标数据');
                        }
                    } else {
                        throw new Error(resp.error || '获取位置失败');
                    }
                } catch (error) {
                    console.error('加载位置失败:', error);
                    set({
                        locationError: error.message || '获取位置失败，请重试'
                    });
                } finally {
                    set({
                        isLocationLoading: false,
                        isLoadingLocation: false
                    });
                }
            },

            // URL Location Actions
            loadLocationFromURL: async (lat, lng) => {
                const state = get();
                if (state.isLoadingLocation) return;

                set({
                    isLoadingLocation: true,
                    isLocationLoading: true,
                    location: null,
                    description: null,
                    descriptionError: null
                });

                try {
                    const currentLanguage = getActiveLanguage();
                    const resp = await lookupLocation(lat, lng, currentLanguage, 'shared');

                    if (!get().isLoadingLocation) return;

                    if (resp.success && resp.data) {
                        const locLat = Number(resp.data.latitude);
                        const locLng = Number(resp.data.longitude);

                        if (!isNaN(locLat) && !isNaN(locLng)) {
                            const locationData = {
                                ...resp.data,
                                latitude: locLat,
                                longitude: locLng
                            };

                            set({
                                location: locationData,
                                currentLocationRef: locationData,
                                locationError: null
                            });
                        } else {
                            throw new Error('无效的坐标数据');
                        }
                    } else {
                        throw new Error(resp.error || '查找位置失败');
                    }
                } catch (error) {
                    console.error('从URL加载位置失败:', error);
                    set({
                        locationError: error.message || '查找位置失败，请重试'
                    });
                } finally {
                    set({
                        isLocationLoading: false,
                        isLoadingLocation: false
                    });
                }
            },

            // Description Actions
            loadLocationDescription: async (panoId, retryCount = 0) => {
                const MAX_RETRIES = 3;
                const currentLanguage = getActiveLanguage();
                const requestKey = `${panoId}:${currentLanguage}:${Date.now()}:${retryCount}`;

                set({
                    isDescriptionLoading: true,
                    description: null,
                    descriptionCitations: null,
                    descriptionError: null,
                    descriptionRetries: retryCount,
                    descriptionRequestKey: requestKey
                });

                try {
                    const resp = await getLocationDescription(panoId, currentLanguage);
                    const latestState = get();

                    if (
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
                            descriptionError: null
                        });
                    } else {
                        throw new Error(resp.error || '获取描述失败');
                    }
                } catch (error) {
                    console.error('加载描述失败:', error);

                    if (get().descriptionRequestKey !== requestKey) {
                        return;
                    }

                    // 自动重试逻辑
                    if (retryCount < MAX_RETRIES && get().networkState) {
                        const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000);
                        setTimeout(() => {
                            const state = get();
                            if (state.currentLocationRef?.pano_id === panoId) {
                                state.loadLocationDescription(panoId, retryCount + 1);
                            }
                        }, retryDelay);
                    } else {
                        set({
                            descriptionError: '获取位置描述失败'
                        });
                    }
                } finally {
                    if (get().descriptionRequestKey === requestKey) {
                        set({ isDescriptionLoading: false });
                    }
                }
            },

            // Exploration Mode Actions
            initializeExplorationMode: () => {
                const savedMode = localStorage.getItem(EXPLORATION_MODE_KEY);
                const savedInterest = localStorage.getItem(EXPLORATION_INTEREST_KEY) || '';

                if (savedMode === EXPLORATION_MODES.CUSTOM && savedInterest) {
                    set({
                        explorationMode: EXPLORATION_MODES.CUSTOM,
                        explorationInterest: savedInterest,
                        isExplorationInitialized: true
                    });
                    // 确保后端也有这个偏好
                    setExplorationPreference(savedInterest).catch(console.error);
                } else {
                    set({
                        explorationMode: EXPLORATION_MODES.RANDOM,
                        explorationInterest: '',
                        isExplorationInitialized: true
                    });
                    localStorage.removeItem(EXPLORATION_MODE_KEY);
                    localStorage.removeItem(EXPLORATION_INTEREST_KEY);
                }
            },

            handleModeChange: async (mode) => {
                if (mode === EXPLORATION_MODES.RANDOM) {
                    localStorage.setItem(EXPLORATION_MODE_KEY, EXPLORATION_MODES.RANDOM);
                    localStorage.removeItem(EXPLORATION_INTEREST_KEY);

                    set({
                        explorationMode: EXPLORATION_MODES.RANDOM,
                        explorationInterest: '',
                        preferenceError: null
                    });

                    try {
                        await deleteExplorationPreference();
                    } catch (error) {
                        console.error('删除探索偏好失败:', error);
                    }

                    // 刷新位置
                    get().loadRandomLocation();
                } else if (mode === EXPLORATION_MODES.CUSTOM) {
                    set({ explorationMode: EXPLORATION_MODES.CUSTOM });
                }
            },

            handlePreferenceChange: async (interest) => {
                const state = get();
                const now = Date.now();

                // 检查限流
                if (now - state.lastRefreshTime < RATE_LIMIT_MS) {
                    const waitTime = Math.ceil((RATE_LIMIT_MS - (now - state.lastRefreshTime)) / 1000);
                    set({ preferenceError: `请等待 ${waitTime} 秒后再试` });
                    return;
                }

                if (state.isSavingPreference || state.isLoadingLocation) return;

                set({
                    isSavingPreference: true,
                    preferenceError: null,
                    lastRefreshTime: now
                });

                try {
                    const resp = await setExplorationPreference(interest, false);

                    if (resp.success) {
                        localStorage.setItem(EXPLORATION_MODE_KEY, EXPLORATION_MODES.CUSTOM);
                        localStorage.setItem(EXPLORATION_INTEREST_KEY, interest);

                        set({
                            explorationMode: EXPLORATION_MODES.CUSTOM,
                            explorationInterest: interest,
                            preferenceError: null
                        });

                        // 自动刷新位置
                        get().loadRandomLocation(true);
                    } else {
                        throw new Error(resp.error || '保存失败');
                    }
                } catch (error) {
                    console.error('保存探索偏好失败:', error);
                    set({
                        preferenceError: error.message || '保存失败，请重试'
                    });
                } finally {
                    set({ isSavingPreference: false });
                }
            },

            // UI Actions
            setHeading: (heading) => {
                const numericHeading = Number(heading);
                if (!Number.isFinite(numericHeading)) return;

                const normalizedHeading = ((Math.round(numericHeading) % 360) + 360) % 360;
                if (get().heading !== normalizedHeading) {
                    set({ heading: normalizedHeading });
                }
            },
            setScale: (scale) => set({ scale }),

            showToastMessage: (message) => {
                set({
                    toastMessage: message,
                    showToast: true
                });

                // 3秒后自动隐藏
                setTimeout(() => {
                    set({ showToast: false });
                }, 3000);
            },

            // Network State Actions
            setNetworkState: (state) => set({ networkState: state }),

            // Reset Actions
            resetLocationError: () => set({ locationError: null }),
            resetDescriptionError: () => set({ descriptionError: null }),
        }),
        {
            name: 'streetview-store'
        }
    )
);

export default useStore;
