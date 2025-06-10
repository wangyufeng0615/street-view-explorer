// Basic API wrappers to call backend
// Assuming backend runs on same origin or set proper baseURL.

import { getOrCreateSessionId } from '../utils/session';
import i18n from '../i18n'; // 导入i18n实例获取当前语言

const API_V1 = '/api/v1';
const DEFAULT_TIMEOUT = 10000; // 10 seconds

// 获取当前语言，默认为英文
function getCurrentLanguage() {
    return i18n.language || 'en';
}

// 带超时的 fetch
async function fetchWithTimeout(url, options, timeout = DEFAULT_TIMEOUT) {
    // If an external signal is provided in options and it's already aborted, throw immediately.
    if (options.signal instanceof AbortSignal && options.signal.aborted) {
        // Throw an error that looks like a fetch AbortError
        const abortError = new DOMException('The operation was aborted.', 'AbortError');
        throw abortError;
    }

    // If an external signal is provided, use it and bypass internal timeout logic.
    if (options.signal instanceof AbortSignal) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (err) {
            // Ensure the error is an AbortError if the external signal caused it.
            if (err.name === 'AbortError') {
                throw err;
            }
            // For other errors, or if it was an abort not from the signal (less likely with fetch API),
            // rethrow or wrap if necessary. For now, just rethrow.
            throw err;
        }
    } else {
        // No external signal, manage timeout internally.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            return response;
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }
}

// 获取随机位置
export async function getRandomLocation(language = null) {
    // 如果没有传入语言参数，使用当前语言
    const lang = language || getCurrentLanguage();
    
    try {
        const resp = await fetchWithTimeout(`${API_V1}/locations/random?lang=${lang}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': getOrCreateSessionId(),
            },
        });
        const data = await resp.json();

        if (data.success && data.data?.location) {
            return {
                success: true,
                data: data.data.location,
                message: data.message,
                error: null,
            };
        }
        
        return {
            success: false,
            data: null,
            message: null,
            error: data.error || '获取位置失败',
        };
    } catch (err) {
        return {
            success: false,
            data: null,
            message: null,
            error: err.name === 'AbortError' ? '请求超时' : (err.message || '网络请求失败'),
        };
    }
}

// 获取位置的 AI 描述
export async function getLocationDescription(panoId, language = null, signal = null) {
    if (!panoId) {
        return {
            success: false,
            data: null,
            message: null,
            error: 'Missing location ID',
        };
    }
    
    // 如果没有传入语言参数，使用当前语言
    const lang = language || getCurrentLanguage();

    try {
        const fetchOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': getOrCreateSessionId(),
            },
        };

        if (signal instanceof AbortSignal) {
            fetchOptions.signal = signal;
        }

        const resp = await fetchWithTimeout(
            `${API_V1}/locations/${panoId}/description?lang=${lang}`,
            fetchOptions // Pass options, which may or may not include the signal
                       // fetchWithTimeout's default timeout will be used if signal is not in fetchOptions
        );
        const data = await resp.json();
    
        if (data.success) {
            return {
                success: true,
                data: data.data?.description,
                language: data.data?.language,
                message: data.message,
                error: null,
            };
        }

        return {
            success: false,
            data: null,
            language: null,
            message: null,
            error: data.error || '获取描述失败',
        };
    } catch (err) {
        return {
            success: false,
            data: null,
            language: null,
            message: null,
            error: err.name === 'AbortError' ? '请求超时' : (err.message || '获取描述失败'),
        };
    }
}

// 设置探索偏好
export async function setExplorationPreference(interest, language = null) {
    // 如果没有传入语言参数，使用当前语言
    const lang = language || getCurrentLanguage();
    
    try {
        const resp = await fetchWithTimeout(`${API_V1}/preferences/exploration?lang=${lang}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': getOrCreateSessionId(),
            },
            body: JSON.stringify({ interest }),
        });
        const data = await resp.json();
        
        return {
            success: data.success,
            error: data.error,
            message: data.message || '探索偏好设置成功',
        };
    } catch (err) {
        return {
            success: false,
            error: err.name === 'AbortError' ? '请求超时' : (err.message || '网络请求失败'),
            message: null,
        };
    }
}

// 删除探索偏好
export async function deleteExplorationPreference(language = null) {
    // 如果没有传入语言参数，使用当前语言
    const lang = language || getCurrentLanguage();
    
    try {
        const response = await fetchWithTimeout(`${API_V1}/preferences/exploration/remove?lang=${lang}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': getOrCreateSessionId(),
            },
        });

        const data = await response.json();
        return {
            success: data.success,
            error: data.error || data.detail,
            message: data.message || '探索偏好已删除',
        };
    } catch (err) {
        console.error('Error deleting preference:', err);
        return {
            success: false,
            error: err.name === 'AbortError' ? '请求超时' : (err.message || '删除探索兴趣失败'),
            message: null,
        };
    }
}

// 获取位置的详细AI介绍
export async function getLocationDetailedDescription(panoId, language = null, signal = null) {
    if (!panoId) {
        return {
            success: false,
            data: null,
            message: null,
            error: 'Missing location ID',
        };
    }
    
    // 如果没有传入语言参数，使用当前语言
    const lang = language || getCurrentLanguage();

    try {
        const fetchOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': getOrCreateSessionId(),
            },
        };

        if (signal instanceof AbortSignal) {
            fetchOptions.signal = signal;
        }

        const resp = await fetchWithTimeout(
            `${API_V1}/locations/${panoId}/detailed-description?lang=${lang}`,
            fetchOptions,
            30000 // 30秒超时，详细描述需要更长的AI处理时间
        );
        const data = await resp.json();
    
        if (data.success) {
            return {
                success: true,
                data: data.data?.description,
                language: data.data?.language,
                message: data.message,
                error: null,
            };
        }

        return {
            success: false,
            data: null,
            language: null,
            message: null,
            error: data.error || '获取详细介绍失败',
        };
    } catch (err) {
        return {
            success: false,
            data: null,
            language: null,
            message: null,
            error: err.name === 'AbortError' ? '请求超时' : (err.message || '获取详细介绍失败'),
        };
    }
}
