// Basic API wrappers to call backend

import { getOrCreateSessionId } from "../utils/session";
import i18n from "../i18n";

const API_V1 = "/api/v1";
const DEFAULT_TIMEOUT = 25000; // 25 seconds (AI generation can take longer)

// 获取当前语言，默认为英文
function getCurrentLanguage() {
  const language = i18n.resolvedLanguage || i18n.language || "en";
  return language.startsWith("zh") ? "zh" : "en";
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
  const externalSignal = options.signal instanceof AbortSignal ? options.signal : null;
  if (externalSignal?.aborted) {
    const abortError = new DOMException(
      "The operation was aborted.",
      "AbortError",
    );
    throw abortError;
  }

  const controller = new AbortController();
  let timeoutId = null;
  let abortFromExternal = null;

  if (externalSignal) {
    abortFromExternal = () => controller.abort();
    externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }
  if (timeout > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeout);
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (externalSignal && abortFromExternal) {
      externalSignal.removeEventListener("abort", abortFromExternal);
    }
  }
}

// 获取随机位置
export async function getRandomLocation(
  language = null,
  source = null,
  countryCode = null,
) {
  const lang = language || getCurrentLanguage();
  let url = `${API_V1}/locations/random?lang=${lang}`;
  if (source) url += `&source=${encodeURIComponent(source)}`;
  if (countryCode) url += `&country=${encodeURIComponent(countryCode)}`;

  try {
    const resp = await fetchWithTimeout(url, {
      method: "GET",
      headers: getHeaders(),
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
  scope = "nearby",
) {
  const lang = language || getCurrentLanguage();
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    lang,
    source,
    scope,
  });

  try {
    const resp = await fetchWithTimeout(
      `${API_V1}/locations/lookup?${params.toString()}`,
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

// 根据具体地点/地标搜索并跳转到附近街景
export async function searchLocation(query, language = null) {
  const lang = language || getCurrentLanguage();
  const trimmed = String(query || "").trim();

  try {
    const resp = await fetchWithTimeout(
      `${API_V1}/locations/search?q=${encodeURIComponent(trimmed)}&lang=${lang}`,
      {
        method: "GET",
        headers: getHeaders(),
      },
      20000,
    );
    const data = await resp.json();

    if (data.success && data.data?.location) {
      return {
        success: true,
        data: data.data.location,
        place: data.data.place || null,
        error: null,
      };
    }

    return {
      success: false,
      data: null,
      place: data.data?.place || null,
      error: data.error || "搜索地点失败",
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      place: null,
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

    const encodedPanoId = encodeURIComponent(panoId);
    const resp = await fetchWithTimeout(
      `${API_V1}/locations/${encodedPanoId}/description?lang=${lang}`,
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
      `${API_V1}/preferences/exploration?lang=${lang}`,
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
      `${API_V1}/preferences/exploration/remove?lang=${lang}`,
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

// 获取全站共享访问历史
export async function getVisitHistory(limit = 1000, offset = 0) {
  try {
    const resp = await fetchWithTimeout(
      `${API_V1}/visits?limit=${limit}&offset=${offset}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
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

// ==================== Agent Journey API ====================

// 获取旅程列表
export async function getAgentJourneys(token) {
  try {
    const resp = await fetchWithTimeout(
      `${API_V1}/agent/journeys?token=${encodeURIComponent(token)}`,
      { method: "GET" },
    );
    const text = await resp.text();
    if (!text) return { success: false, error: "Empty response" };
    return JSON.parse(text);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// 获取旅程详情 (含 stops)
export async function getAgentJourneyDetail(journeyId, token) {
  try {
    const resp = await fetchWithTimeout(
      `${API_V1}/agent/journeys/${journeyId}?token=${encodeURIComponent(token)}`,
      { method: "GET" },
    );
    const text = await resp.text();
    if (!text) return { success: false, error: "Empty response" };
    return JSON.parse(text);
  } catch (err) {
    return { success: false, error: err.message };
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

    const encodedPanoId = encodeURIComponent(panoId);
    const resp = await fetchWithTimeout(
      `${API_V1}/locations/${encodedPanoId}/detailed-description?lang=${lang}`,
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

export async function createRealtimeClientSecret(language = null) {
  const lang = language || getCurrentLanguage();

  return requestJson(
    `/realtime/client-secret?lang=${encodeURIComponent(lang)}`,
    {
      method: "GET",
    },
    15000,
  );
}

export async function getRealtimeVoiceConfig() {
  return requestJson(
    "/realtime/voice-config",
    {
      method: "GET",
    },
    10000,
  );
}

export async function synthesizeDoubaoTTSStream({ text, language = null, signal = null }) {
  const lang = language || getCurrentLanguage();

  return fetchWithTimeout(
    `${API_V1}/realtime/doubao-tts`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ text, language: lang }),
      signal,
    },
    60000,
  );
}

async function requestJson(path, options = {}, timeout = DEFAULT_TIMEOUT) {
  try {
    const resp = await fetchWithTimeout(
      `${API_V1}${path}`,
      {
        headers: {
          ...getHeaders(),
          ...(options.headers || {}),
        },
        ...options,
      },
      timeout,
    );

    const contentType = resp.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await resp.json()
      : null;

    return {
      success: resp.ok && payload?.success !== false,
      status: resp.status,
      data: payload?.data || null,
      message: payload?.message || null,
      error: payload?.error || (resp.ok ? null : "请求失败"),
    };
  } catch (err) {
    return {
      success: false,
      status: 0,
      data: null,
      message: null,
      error:
        err.name === "AbortError" ? "请求超时" : err.message || "网络请求失败",
    };
  }
}

export async function fetchGeoBattleImage(roomId, cacheKey = "", signal = null) {
  const fetchOptions = { method: "GET", headers: getHeaders() };
  if (signal instanceof AbortSignal) fetchOptions.signal = signal;

  const query = cacheKey
    ? `?v=${encodeURIComponent(cacheKey)}`
    : "";
  const resp = await fetch(
    `${API_V1}/geo/online/rooms/${encodeURIComponent(roomId)}/image${query}`,
    fetchOptions,
  );
  if (!resp.ok) {
    throw new Error(`image ${resp.status}`);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

export async function createGeoBattleRoom(nickname) {
  return requestJson("/geo/online/rooms", {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export async function joinGeoBattleRoom(code, nickname) {
  return requestJson("/geo/online/rooms/join", {
    method: "POST",
    body: JSON.stringify({ code, nickname }),
  });
}

export async function getGeoBattleRoom(roomId) {
  return requestJson(`/geo/online/rooms/${encodeURIComponent(roomId)}`, {
    method: "GET",
  });
}

export async function setGeoBattleReady(roomId, ready) {
  return requestJson(`/geo/online/rooms/${encodeURIComponent(roomId)}/ready`, {
    method: "POST",
    body: JSON.stringify({ ready }),
  });
}

export async function zoomOutGeoBattle(roomId) {
  return requestJson(
    `/geo/online/rooms/${encodeURIComponent(roomId)}/zoom-out`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function submitGeoBattleGuess(roomId, payload) {
  return requestJson(`/geo/online/rooms/${encodeURIComponent(roomId)}/guess`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function leaveGeoBattleRoom(roomId) {
  return requestJson(`/geo/online/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function joinGeoBattleMatchmaking(nickname) {
  return requestJson("/geo/online/matchmaking", {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export async function getGeoBattleMatchmakingStatus() {
  return requestJson("/geo/online/matchmaking", {
    method: "GET",
  });
}

export async function cancelGeoBattleMatchmaking() {
  return requestJson("/geo/online/matchmaking", {
    method: "DELETE",
  });
}
