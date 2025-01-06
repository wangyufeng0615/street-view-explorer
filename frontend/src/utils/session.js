// 生成随机会话ID
function generateSessionId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// 获取或创建会话ID
export function getOrCreateSessionId() {
    let sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
        sessionId = generateSessionId();
        localStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
} 