import { useEffect, useRef, useState } from "react";
import {
  getInitialSatelliteRequestSize,
  getSatelliteRequestSize,
  isSameSatelliteRequestSize,
} from "../utils/geoGameSatellite";

/**
 * Track the satellite panel size and derive the Static Maps request size
 * from its aspect ratio. Attach `satelliteElRef` to the satellite panel.
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

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateSatelliteSize);
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateSatelliteSize);
    return () => window.removeEventListener("resize", updateSatelliteSize);
  }, [phase]);

  return { satelliteElRef, satelliteImageSize };
}
