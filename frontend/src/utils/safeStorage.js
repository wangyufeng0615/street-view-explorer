// @ts-check
// Browsers can throw on the `localStorage` getter itself (blocked cookies,
// sandboxed frames), so every access goes through a try/catch.

/** @returns {Storage | null} */
function getLocalStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage || null : null;
  } catch {
    return null;
  }
}

/** @param {string} key */
export function readLocalStorage(key) {
  try {
    return getLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** @param {string} key @param {string} value */
export function writeLocalStorage(key, value) {
  try {
    const storage = getLocalStorage();
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} key */
export function removeLocalStorage(key) {
  try {
    getLocalStorage()?.removeItem(key);
  } catch {
    // Storage is optional; the in-memory state stays authoritative.
  }
}
