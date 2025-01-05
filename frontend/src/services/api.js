// Basic API wrappers to call backend
// Assuming backend runs on same origin or set proper baseURL.

const API_V1 = '/api/v1';

// 获取随机位置
export async function getRandomLocation() {
    const resp = await fetch(`${API_V1}/locations/random`, {
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
    });
    const data = await resp.json();

    // 确保返回的数据格式正确
    if (data.success && data.data?.location) {
        return {
            success: true,
            data: data.data.location,
            error: null,
        };
    }
    
    return {
        success: false,
        data: null,
        error: data.error || '获取位置失败',
    };
}

// 获取位置的 AI 描述
export async function getLocationDescription(panoId, language = 'zh') {
    if (!panoId) {
        return {
            success: false,
            data: null,
            error: 'Missing location ID',
        };
    }

    try {
        const resp = await fetch(`${API_V1}/locations/${panoId}/description?lang=${language}`, {
            method: 'GET',
            headers: {'Content-Type': 'application/json'},
        });
        const data = await resp.json();
    
        return {
            success: data.success,
            data: data.data?.description,
            language: data.data?.language,
            error: data.error,
        };
    } catch (err) {
        return {
            success: false,
            data: null,
            error: err.message || 'Failed to get description',
        };
    }
}

// 设置探索偏好
export async function setExplorationPreference(interest) {
    const resp = await fetch(`${API_V1}/preferences/exploration`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ interest }),
    });
    const data = await resp.json();
    return {
        success: data.success,
        error: data.error,
    };
}

// 删除探索偏好
export async function deleteExplorationPreference() {
    const resp = await fetch(`${API_V1}/preferences/exploration/remove`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
    });
    const data = await resp.json();
    return {
        success: data.success,
        error: data.error,
        detail: data.detail,
    };
}
