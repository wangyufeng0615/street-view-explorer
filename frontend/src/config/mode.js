// VITE_APP_MODE=cn 启用 CN 模式，否则根据域名自动检测
const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
export const APP_MODE =
  import.meta.env.VITE_APP_MODE ||
  (hostname.includes('earth-cn') ? 'cn' : 'global');
export const isCNMode = APP_MODE === 'cn';
