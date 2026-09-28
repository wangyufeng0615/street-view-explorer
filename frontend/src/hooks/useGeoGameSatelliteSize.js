import { useEffect, useRef, useState } from "react";
import {
  getInitialSatelliteRequestSize,
  getSatelliteRequestSize,
  isSameSatelliteRequestSize,
} from "../utils/geoGameSatellite";

// Resize bursts (window drags, layout transitions) settle before the request
// size changes, so they do not trigger a satellite fetch per frame.
export const SATELLITE_RESIZE_DEBOUNCE_MS = 200;

/**
 * Track the satellite panel size and derive the Static Maps request size
 * from its aspect ratio. The first measurement is applied immediately; later
 * resizes are debounced. Attach `satelliteElRef` to the satellite panel.
 */
export function useGeoGameSatelliteSize(phase) {
  const satelliteElRef = useRef(null);
  const [satelliteImageSize, setSatelliteImageSize] = useState(
    getInitialSatelliteRequestSize,
  );

  useEffect(() => {
    if (phase === "WELCOME") return;
    const el = satelliteElRef.current;
    if (!el) return;

    const updateSatelliteSize = () => {
      const rect = el.getBoundingClientRect();
      const nextSize = getSatelliteRequestSize(rect.width, rect.height);
      if (!nextSize) return;
      setSatelliteImageSize((currentSize) =>
        isSameSatelliteRequestSize(currentSize, nextSize)
          ? currentSize
          : nextSize,
      );
    };

    updateSatelliteSize();

    let debounceId = null;
    const scheduleUpdate = () => {
      window.clearTimeout(debounceId);
      debounceId = window.setTimeout(
        updateSatelliteSize,
        SATELLITE_RESIZE_DEBOUNCE_MS,
      );
    };

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(scheduleUpdate);
      observer.observe(el);
      return () => {
        window.clearTimeout(debounceId);
        observer.disconnect();
      };
    }

    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.clearTimeout(debounceId);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [phase]);

  return { satelliteElRef, satelliteImageSize };
}
