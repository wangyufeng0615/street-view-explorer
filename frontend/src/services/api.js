// Basic API wrappers to call backend
// Assuming backend runs on same origin or set proper baseURL.

import { getOrCreateSessionId } from '../utils/session';

const API_V1 = '/api/v1';
const DEFAULT_TIMEOUT = 10000; // 10 seconds

// 带超时的 fetch
async function fetchWithTimeout(url, options, timeout = DEFAULT_TIMEOUT) {
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

// 获取随机位置
export async function getRandomLocation() {
    try {
        const resp = await fetchWithTimeout(`${API_V1}/locations/random`, {
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
export async function getLocationDescription(panoId, language = 'zh', signal = null) {
    if (!panoId) {
        return {
            success: false,
            data: null,
            message: null,
            error: 'Missing location ID',
        };
    }

    try {
        const resp = await fetchWithTimeout(
            `${API_V1}/locations/${panoId}/description?lang=${language}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': getOrCreateSessionId(),
                },
                signal: signal instanceof AbortSignal ? signal : undefined,
            }
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
export async function setExplorationPreference(interest) {
    try {
        const resp = await fetchWithTimeout(`${API_V1}/preferences/exploration`, {
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
export async function deleteExplorationPreference() {
    try {
        const response = await fetchWithTimeout(`${API_V1}/preferences/exploration/remove`, {
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
