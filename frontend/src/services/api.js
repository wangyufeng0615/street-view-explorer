// Basic API wrappers to call backend

import { getOrCreateSessionId } from "../utils/session";
import { APP_MODE } from "../config/mode";
import i18n from "../i18n";

const API_V1 = "/api/v1";
const DEFAULT_TIMEOUT = 25000; // 25 seconds (AI generation can take longer)

// 获取当前语言，默认为英文
function getCurrentLanguage() {
  return i18n.language || "en";
}

// 构建带 mode 参数的查询字符串
function modeParam() {
  return APP_MODE !== "global" ? `&mode=${APP_MODE}` : "";
}

// 创建请求头
function getHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Session-ID": getOrCreateSessionId(),
  };
}

// 带超时的 fetch
async function fetchWithTimeout(url, options, timeout = DEFAULT_TIMEOUT) {
  // If an external signal is provided in options and it's already aborted, throw immediately.
  if (options.signal instanceof AbortSignal && options.signal.aborted) {
    const abortError = new DOMException(
      "The operation was aborted.",
      "AbortError",
    );
    throw abortError;
  }

  // If an external signal is provided, use it and bypass internal timeout logic.
  if (options.signal instanceof AbortSignal) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (err) {
      if (err.name === "AbortError") {
        throw err;
      }
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
  const lang = language || getCurrentLanguage();

  try {
    const resp = await fetchWithTimeout(
      `${API_V1}/locations/random?lang=${lang}${modeParam()}`,
      {
        method: "GET",
        headers: getHeaders(),
      },
    );
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
      error: data.error || "获取位置失败",
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      message: null,
      error:
        err.name === "AbortError" ? "请求超时" : err.message || "网络请求失败",
    };
  }
}

// 根据坐标查找位置
export async function lookupLocation(
  lat,
  lng,
  language = null,
  source = "lookup",
) {
  const lang = language || getCurrentLanguage();

  try {
    const resp = await fetchWithTimeout(
      `${API_V1}/locations/lookup?lat=${lat}&lng=${lng}&lang=${lang}&source=${encodeURIComponent(source)}${modeParam()}`,
      {
        method: "GET",
        headers: getHeaders(),
      },
    );
    const data = await resp.json();

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
      error: data.error || "查找位置失败",
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      error:
        err.name === "AbortError" ? "请求超时" : err.message || "网络请求失败",
    };
  }
}

// 获取位置的 AI 描述
export async function getLocationDescription(
  panoId,
  language = null,
  signal = null,
) {
  if (!panoId) {
    return {
      success: false,
      data: null,
      message: null,
      error: "Missing location ID",
    };
  }

  const lang = language || getCurrentLanguage();

  try {
    const fetchOptions = {
      method: "GET",
      headers: getHeaders(),
    };

    if (signal instanceof AbortSignal) {
      fetchOptions.signal = signal;
    }

    const resp = await fetchWithTimeout(
      `${API_V1}/locations/${panoId}/description?lang=${lang}${modeParam()}`,
      fetchOptions,
    );
    const data = await resp.json();

    if (data.success) {
      return {
        success: true,
        data: data.data,
        message: data.message,
        error: null,
      };
    }

    return {
      success: false,
      data: null,
      language: null,
      message: null,
      error: data.error || "获取描述失败",
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      language: null,
      message: null,
      error:
        err.name === "AbortError" ? "请求超时" : err.message || "获取描述失败",
    };
  }
}

// 设置探索偏好
export async function setExplorationPreference(interest, language = null) {
  const lang = language || getCurrentLanguage();

  try {
    const resp = await fetchWithTimeout(
      `${API_V1}/preferences/exploration?lang=${lang}${modeParam()}`,
      {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ interest }),
      },
    );
    const data = await resp.json();

    return {
      success: data.success,
      error: data.error,
      message: data.message || "探索偏好设置成功",
    };
  } catch (err) {
    return {
      success: false,
      error:
        err.name === "AbortError" ? "请求超时" : err.message || "网络请求失败",
      message: null,
    };
  }
}

// 删除探索偏好
export async function deleteExplorationPreference(language = null) {
  const lang = language || getCurrentLanguage();

  try {
    const response = await fetchWithTimeout(
      `${API_V1}/preferences/exploration/remove?lang=${lang}${modeParam()}`,
      {
        method: "POST",
        headers: getHeaders(),
      },
    );

    const data = await response.json();
    return {
      success: data.success,
      error: data.error || data.detail,
      message: data.message || "探索偏好已删除",
    };
  } catch (err) {
    console.error("Error deleting preference:", err);
    return {
      success: false,
      error:
        err.name === "AbortError"
          ? "请求超时"
          : err.message || "删除探索兴趣失败",
      message: null,
    };
  }
}

// 获取访问历史
export async function getVisitHistory(limit = 1000, offset = 0) {
  try {
    const resp = await fetchWithTimeout(
      `${API_V1}/visits?limit=${limit}&offset=${offset}${modeParam()}`,
      {
        method: "GET",
        headers: getHeaders(),
      },
    );
    const data = await resp.json();

    if (data.success) {
      return {
        success: true,
        data: data.data,
        error: null,
      };
    }

    return {
      success: false,
      data: null,
      error: data.error || "获取访问历史失败",
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      error:
        err.name === "AbortError" ? "请求超时" : err.message || "网络请求失败",
    };
  }
}

// 获取位置的详细AI介绍
export async function getLocationDetailedDescription(
  panoId,
  language = null,
  signal = null,
) {
  if (!panoId) {
    return {
      success: false,
      data: null,
      message: null,
      error: "Missing location ID",
    };
  }

  const lang = language || getCurrentLanguage();

  try {
    const fetchOptions = {
      method: "GET",
      headers: getHeaders(),
    };

    if (signal instanceof AbortSignal) {
      fetchOptions.signal = signal;
    }

    const resp = await fetchWithTimeout(
      `${API_V1}/locations/${panoId}/detailed-description?lang=${lang}${modeParam()}`,
      fetchOptions,
      30000, // 30秒超时，详细描述需要更长的AI处理时间
    );
    const data = await resp.json();

    if (data.success) {
      return {
        success: true,
        data: data.data,
        message: data.message,
        error: null,
      };
    }

    return {
      success: false,
      data: null,
      language: null,
      message: null,
      error: data.error || "获取详细介绍失败",
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      language: null,
      message: null,
      error:
        err.name === "AbortError"
          ? "请求超时"
          : err.message || "获取详细介绍失败",
    };
  }
}
