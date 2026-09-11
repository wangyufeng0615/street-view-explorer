const RELOAD_KEY = "streetview:preload-recovery";

// Vite also dispatches preloadError for exceptions while evaluating a module.
// Only retry resource loading failures, never application exceptions.
const RESOURCE_ERROR =
  /^(Unable to preload CSS for |Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module)/i;

export function initPreloadRecovery(browser = window) {
  let reloading = false;
  const onPreloadError = (event) => {
    if (!RESOURCE_ERROR.test(event.payload?.message || "")) return;
    if (reloading) {
      event.preventDefault();
      return;
    }
    if (browser.navigator.onLine === false) return;

    try {
      // Persist across reloads: at most one automatic refresh per tab session.
      // If storage is unavailable, leave the normal error boundary/reporting in place.
      if (browser.sessionStorage.getItem(RELOAD_KEY)) return;
      browser.sessionStorage.setItem(RELOAD_KEY, "1");
      browser.location.reload();
      reloading = true;
      event.preventDefault();
    } catch {
      // A failed refresh must not swallow the original loading error.
    }
  };

  browser.addEventListener("vite:preloadError", onPreloadError);
  return () => browser.removeEventListener("vite:preloadError", onPreloadError);
}
