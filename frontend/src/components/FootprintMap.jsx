import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import { loadGoogleMapsScript } from "../utils/googleMaps";
import { getVisitHistory } from "../services/api";

function getUniqueVisits(visits) {
  const seen = new Map();

  for (const visit of visits) {
    if (!visit?.pano_id || seen.has(visit.pano_id)) {
      continue;
    }
    seen.set(visit.pano_id, visit);
  }

  return Array.from(seen.values());
}

function openVisitInNewTab(lat, lng) {
  const url = new URL(window.location.href);
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lng", lng.toFixed(6));
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

const GLOBAL_VIEW = { center: { lat: 20, lng: 0 }, zoom: 2 };

export default function FootprintMap({ onClose }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const [visits, setVisits] = useState([]);
  const [uniquePlaceCount, setUniquePlaceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(true);
  const [error, setError] = useState(null);
  const { t } = useTranslation();
  const uniqueVisits = useMemo(() => getUniqueVisits(visits), [visits]);

  // Fetch the shared site-wide visit history.
  useEffect(() => {
    let cancelled = false;

    async function fetchVisits() {
      const resp = await getVisitHistory(5000);
      if (cancelled) return;

      if (resp.success && resp.data) {
        const fetchedVisits = resp.data.visits || [];
        setVisits(fetchedVisits);
        setUniquePlaceCount(
          typeof resp.data.unique_places === "number"
            ? resp.data.unique_places
            : getUniqueVisits(fetchedVisits).length,
        );
      } else {
        setError(resp.error);
      }
      setLoading(false);
    }

    fetchVisits();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize map and markers
  const initMap = useCallback(async () => {
    if (!mapRef.current || uniqueVisits.length === 0) return;

    try {
      setMapLoading(true);
      const maps = await loadGoogleMapsScript();
      if (!mapRef.current) return;

      markersRef.current.forEach((marker) => {
        marker.map = null;
      });
      markersRef.current = [];

      const map = new maps.Map(mapRef.current, {
        mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
        center: GLOBAL_VIEW.center,
        zoom: GLOBAL_VIEW.zoom,
        mapTypeId: "satellite",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true,
        zoomControlOptions: {
          position: maps.ControlPosition.RIGHT_BOTTOM,
        },
        gestureHandling: "greedy",
        disableDefaultUI: false,
        keyboardShortcuts: true,
      });

      mapInstanceRef.current = map;

      // Listen for tiles loaded to dismiss loading indicator
      maps.event.addListenerOnce(map, "tilesloaded", () => {
        setMapLoading(false);
      });

      // Add markers
      if (maps.marker?.AdvancedMarkerElement) {
        const bounds = new maps.LatLngBounds();
        let validMarkerCount = 0;
        let lastValidPosition = null;

        for (const visit of uniqueVisits) {
          const lat = parseFloat(visit.latitude);
          const lng = parseFloat(visit.longitude);
          if (isNaN(lat) || isNaN(lng)) continue;
          validMarkerCount += 1;
          lastValidPosition = { lat, lng };

          const dot = document.createElement("div");
          dot.style.width = "10px";
          dot.style.height = "10px";
          dot.style.borderRadius = "50%";
          dot.style.backgroundColor = "#FFD54F";
          dot.style.border = "2px solid rgba(255, 255, 255, 0.9)";
          dot.style.boxShadow = "0 0 6px rgba(255, 213, 79, 0.6)";
          dot.style.cursor = "pointer";
          dot.style.transition = "transform 0.2s ease";

          const marker = new maps.marker.AdvancedMarkerElement({
            map,
            position: { lat, lng },
            content: dot,
            title: visit.formatted_address || visit.country || "",
          });

          // Hover effect
          dot.addEventListener("mouseenter", () => {
            dot.style.transform = "scale(1.8)";
            dot.style.boxShadow = "0 0 12px rgba(255, 213, 79, 0.9)";
          });
          dot.addEventListener("mouseleave", () => {
            dot.style.transform = "scale(1)";
            dot.style.boxShadow = "0 0 6px rgba(255, 213, 79, 0.6)";
          });

          // Click → open street view in new tab via our app
          dot.addEventListener("click", () => {
            openVisitInNewTab(lat, lng);
          });

          markersRef.current.push(marker);
          bounds.extend({ lat, lng });
        }

        // Fit map to show all markers
        if (validMarkerCount > 1) {
          map.fitBounds(bounds, {
            top: 80,
            bottom: 60,
            left: 40,
            right: 40,
          });
        } else if (validMarkerCount === 1 && lastValidPosition) {
          map.setCenter(lastValidPosition);
          map.setZoom(5);
        }
      }
    } catch (err) {
      console.error("FootprintMap init error:", err);
      setError(t("error.mapLoadFailed"));
      setMapLoading(false);
    }
  }, [uniqueVisits, t]);

  useEffect(() => {
    if (!loading && uniqueVisits.length > 0) {
      initMap();
    }

    return () => {
      markersRef.current.forEach((m) => {
        m.map = null;
      });
      markersRef.current = [];
      mapInstanceRef.current = null;
    };
  }, [loading, uniqueVisits.length, initMap]);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleResetView = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setCenter(GLOBAL_VIEW.center);
      mapInstanceRef.current.setZoom(GLOBAL_VIEW.zoom);
    }
  };

  return (
    <div style={styles.overlay}>
      {/* Close button */}
      <button
        style={styles.closeButton}
        onClick={onClose}
        className="hover-scale"
        title={t("footprint.close")}
      >
        ✕
      </button>

      {/* Stats badge */}
      <div style={styles.statsBadge}>
        <span style={styles.statsIcon}>🌍</span>
        <span style={styles.statsText}>
          {loading
            ? t("footprint.loading")
            : t("footprint.total", { count: uniquePlaceCount })}
        </span>
      </div>

      {/* Map or empty state */}
      {loading ? (
        <div style={styles.centerMessage}>{t("footprint.loading")}</div>
      ) : error ? (
        <div style={styles.centerMessage}>{error}</div>
      ) : uniqueVisits.length === 0 ? (
        <div style={styles.centerMessage}>{t("footprint.empty")}</div>
      ) : (
        <>
          <div ref={mapRef} style={styles.map} />

          {/* Satellite map loading indicator */}
          {mapLoading && (
            <div style={styles.mapLoadingOverlay}>
              <div style={styles.mapLoadingSpinner} />
              <span style={styles.mapLoadingText}>
                {t("footprint.loading_map")}
              </span>
            </div>
          )}

          {/* Reset to global view button */}
          <button
            style={styles.resetViewButton}
            onClick={handleResetView}
            className="hover-scale"
          >
            🌐 {t("footprint.reset_view")}
          </button>
        </>
      )}
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
    backgroundColor: "#000",
  },
  closeButton: {
    position: "absolute",
    top: "16px",
    right: "16px",
    zIndex: 2001,
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "none",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    color: "#fff",
    fontSize: "18px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(8px)",
    transition: "background-color 0.2s ease",
  },
  statsBadge: {
    position: "absolute",
    top: "16px",
    left: "16px",
    zIndex: 2001,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 16px",
    borderRadius: "20px",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    backdropFilter: "blur(8px)",
    color: "#fff",
  },
  statsIcon: {
    fontSize: "16px",
  },
  statsText: {
    fontSize: "14px",
    fontWeight: "500",
    fontFamily:
      '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  map: {
    width: "100%",
    height: "100%",
  },
  centerMessage: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: "16px",
    fontFamily:
      '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  mapLoadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2001,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    pointerEvents: "none",
  },
  mapLoadingSpinner: {
    width: "32px",
    height: "32px",
    border: "3px solid rgba(255, 255, 255, 0.2)",
    borderTopColor: "#FFD54F",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  mapLoadingText: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: "14px",
    fontFamily:
      '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  resetViewButton: {
    position: "absolute",
    bottom: "24px",
    right: "16px",
    zIndex: 2001,
    padding: "8px 16px",
    borderRadius: "20px",
    border: "none",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    backdropFilter: "blur(8px)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: "500",
    cursor: "pointer",
    fontFamily:
      '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    transition: "background-color 0.2s ease",
  },
};
