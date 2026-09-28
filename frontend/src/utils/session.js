import { readLocalStorage, writeLocalStorage } from "./safeStorage";

// 存储不可用时退回到内存里的会话ID，保证本次页面内请求仍能关联同一会话
let memorySessionId = null;

// 生成随机会话ID
function generateSessionId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 获取或创建会话ID
export function getOrCreateSessionId() {
  let sessionId = readLocalStorage("sessionId") || memorySessionId;
  if (!sessionId) {
    sessionId = generateSessionId();
    writeLocalStorage("sessionId", sessionId);
  }
  memorySessionId = sessionId;
  return sessionId;
}

// Alias for backward compatibility
export const getSessionId = getOrCreateSessionId;
