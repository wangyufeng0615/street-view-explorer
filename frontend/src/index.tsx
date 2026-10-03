import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";
import "./i18n";
import { initErrorHandlers } from "./services/sentryLazy";
import { initPreloadRecovery } from "./utils/preloadRecovery";
import { unregisterRetiredServiceWorkers } from "./utils/retiredServiceWorkers";

initPreloadRecovery();
unregisterRetiredServiceWorkers();
// Initialize lightweight error handlers (Sentry loads on-demand)
initErrorHandlers();

const container = document.getElementById("root");
if (!container) throw new Error("Failed to find the root element");
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      {/* 只在语言资源就绪前短暂出现，那时还不知道该用哪种语言，留空即可 */}
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </AppErrorBoundary>
  </React.StrictMode>,
);
