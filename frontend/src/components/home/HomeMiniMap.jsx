import React, {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import useDismiss from "../../hooks/useDismiss";
import useStore from "../../store/useStore";
import { CloseGlyph, ExpandGlyph } from "./HomeGlyphs";

const GlobalMap = lazy(() => import("../GlobalMap"));
const PreviewMap = lazy(() => import("../PreviewMap"));

// Let the panorama claim the network first; the map is secondary. The maps
// start once the first panorama has painted (or after this long if it never
// does), and then stay mounted across stops.
const MAP_LOAD_FALLBACK_MS = 3000;

function useFirstMapLoad(panoId) {
  const [ready, setReady] = useState(false);
  const panoramaShown = useStore((state) => Boolean(state.streetViewView));

  useEffect(() => {
    if (ready || !panoId) return undefined;

    let idleId = null;
    const load = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => setReady(true), {
          timeout: 1200,
        });
      } else {
        setReady(true);
      }
    };
    const timerId = window.setTimeout(
      load,
      panoramaShown ? 0 : MAP_LOAD_FALLBACK_MS,
    );

    return () => {
      window.clearTimeout(timerId);
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [panoId, panoramaShown, ready]);

  return ready;
}

const PANEL_MAPS = [
  ["world", GlobalMap, "global"],
  ["nearby", PreviewMap, "preview"],
];

const HomeMiniMap = memo(function HomeMiniMap({
  location,
  onMapLocationPick,
  isMapPickLoading,
  mapPickStatus,
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState("world");
  // 放大的地图看过一次就留着：每新建一张 Google 地图都算一次计费加载，还要重新取图块
  const [seenScopes, setSeenScopes] = useState([]);
  if (expanded && !seenScopes.includes(scope)) {
    setSeenScopes([...seenScopes, scope]);
  }
  const panelRef = useRef(null);
  const openerRef = useRef(null);
  const mapReady = useFirstMapLoad(location?.pano_id);
  // location is briefly null while the next stop loads; keep showing the last
  // one so the map is moved instead of unmounted and rebuilt.
  const [mapLocation, setMapLocation] = useState(location);
  if (location && location !== mapLocation) {
    setMapLocation(location);
  }
  const hasLocation = Boolean(mapLocation) && mapReady;

  const collapse = (restoreFocus) => {
    setExpanded(false);
    if (restoreFocus) openerRef.current?.focus();
  };

  useDismiss(expanded, panelRef, (reason) => collapse(reason === "escape"));

  // 打开后把焦点放到当前地图的切换按钮上，键盘用户不用绕回来找浮层
  useEffect(() => {
    if (!expanded) return;
    panelRef.current?.querySelector('[aria-pressed="true"]')?.focus();
  }, [expanded]);

  // A successful pick already moved the explorer; fold the map away.
  useEffect(() => {
    if (!expanded || mapPickStatus?.status !== "success") return undefined;
    const timerId = window.setTimeout(() => setExpanded(false), 700);
    return () => window.clearTimeout(timerId);
  }, [expanded, mapPickStatus?.status]);

  const pickProps = (mapId) => ({
    mapId,
    onLocationPick: onMapLocationPick,
    isPickingLocation: isMapPickLoading,
    pickStatus: mapPickStatus?.mapId === mapId ? mapPickStatus.status : "idle",
    pickMessage: mapPickStatus?.mapId === mapId ? mapPickStatus.message : "",
  });

  const openPanel = (nextScope, opener) => {
    openerRef.current = opener;
    setScope(nextScope);
    setExpanded(true);
  };

  // Both scales at once: where on Earth, and what is right around here. The
  // enlarged map floats over the street view so the column never reflows.
  return (
    <>
      <div className="home-minimaps">
        {[
          ["world", GlobalMap, "mini-world"],
          ["nearby", PreviewMap, "mini-nearby"],
        ].map(([value, MapComponent, mapId]) => (
          <div key={value} className="home-minimap">
            {hasLocation && (
              <Suspense fallback={null}>
                <MapComponent
                  latitude={mapLocation.latitude}
                  longitude={mapLocation.longitude}
                  mapId={mapId}
                />
              </Suspense>
            )}
            <button
              type="button"
              className="home-minimap__open"
              aria-label={`${t("home.map.expand")}: ${t(`home.map.${value}`)}`}
              onClick={(event) => openPanel(value, event.currentTarget)}
            >
              <span className="home-minimap__badge">
                <ExpandGlyph size={13} />
              </span>
            </button>
          </div>
        ))}
      </div>

      {seenScopes.length > 0 && (
        <div
          className={`home-map-panel home-panel${expanded ? "" : " is-collapsed"}`}
          ref={panelRef}
          role="dialog"
          aria-label={t("home.map.title")}
          aria-hidden={!expanded}
          inert={expanded ? undefined : ""}
        >
          <div className="home-map-panel__header">
            <div className="home-segmented" role="group">
              {["world", "nearby"].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                >
                  {t(`home.map.${value}`)}
                </button>
              ))}
            </div>
            <span className="home-map-panel__hint">
              {t("home.map.pickHint")}
            </span>
            <button
              type="button"
              className="home-icon-button"
              aria-label={t("home.map.collapse")}
              onClick={() => collapse(true)}
            >
              <CloseGlyph />
            </button>
          </div>
          <div className="home-map-panel__body">
            {mapLocation &&
              PANEL_MAPS.filter(([value]) => seenScopes.includes(value)).map(
                ([value, MapComponent, mapId]) => (
                  <div
                    key={value}
                    className={`home-map-panel__map${
                      scope === value ? "" : " is-hidden"
                    }`}
                  >
                    <Suspense fallback={null}>
                      <MapComponent
                        latitude={mapLocation.latitude}
                        longitude={mapLocation.longitude}
                        {...pickProps(mapId)}
                      />
                    </Suspense>
                  </div>
                ),
              )}
          </div>
        </div>
      )}
    </>
  );
});

export default HomeMiniMap;
