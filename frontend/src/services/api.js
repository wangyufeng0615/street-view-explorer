// Basic API wrappers to call backend
// Assuming backend runs on same origin or set proper baseURL.

const BASE_URL = process.env.REACT_APP_API_BASE_URL || '';
const API_V1 = `${BASE_URL}/api/v1`;

// 获取随机位置（包含描述）
export async function getRandomLocation() {
    const resp = await fetch(`${API_V1}/locations/random`, {
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
    });
    const data = await resp.json();
    return {
        success: data.success,
        data: data.data?.location,  // 位置信息
        description: data.data?.description,  // 描述信息
        error: data.error,
    };
}

// 获取位置的 AI 描述
export async function getLocationDescription(panoId) {
    const resp = await fetch(`${API_V1}/locations/${panoId}/description`, {
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
    });
    const data = await resp.json();
    return {
        success: data.success,
        data: data.data?.description,  // 只返回描述信息
        error: data.error,
    };
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
