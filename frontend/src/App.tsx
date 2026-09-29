import React, { useEffect, useState, lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  type Location,
} from "react-router-dom";
import HomePage from "./pages/HomePage";
import FootprintPage from "./pages/FootprintPage";
import { getOrCreateSessionId } from "./utils/session";
import { testSentry } from "./services/sentryLazy";

const AgentPage = lazy(() => import("./pages/AgentPage"));
const LetterPage = lazy(() => import("./pages/LetterPage"));
const GeoGamePage = lazy(() => import("./pages/GeoGamePage"));
const GeoBattlePage = lazy(() => import("./pages/GeoBattlePage"));

function LegacyGeoRedirect() {
  const location = useLocation();
  const nextPath = location.pathname.replace(/^\/geo/, "/guess");

  return (
    <Navigate to={`${nextPath}${location.search}${location.hash}`} replace />
  );
}

// Create router with future flags enabled
const router = {
  future: {
    v7_startTransition: true,
    v7_relativeSplatPath: true,
  },
};

declare global {
  interface Window {
    testSentry: () => void;
  }
}

// 从首页打开足迹时带上 backgroundLocation：首页留在底下，足迹作为浮层叠在上面。
// history.state 在刷新后仍保留，所以页面刚加载时的那条记录一律按直接访问处理。
function useBackgroundLocation(location: Location): Location | null {
  const [initialKey] = useState(location.key);
  const state = location.state as { backgroundLocation?: Location } | null;
  if (!state?.backgroundLocation || location.key === initialKey) return null;
  return state.backgroundLocation;
}

function AppRoutes() {
  const location = useLocation();
  const backgroundLocation = useBackgroundLocation(location);

  return (
    <>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          margin: 0,
          padding: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Routes location={backgroundLocation || location}>
          <Route
            path="/"
            element={<HomePage footprintOverlayOpen={!!backgroundLocation} />}
          />
          <Route path="/footprints" element={<FootprintPage />} />
          <Route
            path="/agent"
            element={
              <Suspense
                fallback={
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#0a0a0f",
                      color: "#d1d5db",
                      fontSize: "14px",
                    }}
                  >
                    Loading agent journey...
                  </div>
                }
              >
                <AgentPage />
              </Suspense>
            }
          />
          <Route
            path="/guess"
            element={
              <Suspense
                fallback={
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#f7f5f0",
                      color: "#4b5563",
                      fontSize: "14px",
                    }}
                  >
                    Loading...
                  </div>
                }
              >
                <GeoGamePage />
              </Suspense>
            }
          />
          <Route
            path="/guess/online"
            element={
              <Suspense
                fallback={
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#f7f5f0",
                      color: "#4b5563",
                      fontSize: "14px",
                    }}
                  >
                    Loading...
                  </div>
                }
              >
                <GeoBattlePage />
              </Suspense>
            }
          />
          <Route
            path="/guess/online/:roomId"
            element={
              <Suspense
                fallback={
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#f7f5f0",
                      color: "#4b5563",
                      fontSize: "14px",
                    }}
                  >
                    Loading...
                  </div>
                }
              >
                <GeoBattlePage />
              </Suspense>
            }
          />
          <Route path="/geo/*" element={<LegacyGeoRedirect />} />
          <Route
            path="/agent/letter/:id"
            element={
              <Suspense fallback={null}>
                <LetterPage />
              </Suspense>
            }
          />
        </Routes>
      </div>
      {backgroundLocation && (
        <Routes>
          <Route path="/footprints" element={<FootprintPage isOverlay />} />
        </Routes>
      )}
    </>
  );
}

function App() {
  useEffect(() => {
    // 确保有会话ID
    getOrCreateSessionId();

    // Make testSentry available globally for manual testing
    window.testSentry = testSentry;
  }, []);

  return (
    <Router {...router}>
      <AppRoutes />
    </Router>
  );
}

export default App;
