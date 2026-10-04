import { useEffect, useState } from "react";
import { formatAddress } from "../utils/addressUtils";

const STORAGE_KEY = "atlasJourney";
const MAX_STOPS = 30;

function readStoredStops() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored) ? stored.slice(-MAX_STOPS) : [];
  } catch {
    return [];
  }
}

export function appendJourneyStop(stops, stop) {
  const index = stops.findIndex((item) => item.panoId === stop.panoId);
  if (index === -1) return [...stops, stop].slice(-MAX_STOPS);
  // Revisiting keeps the trip in the order it was travelled; only refresh the
  // label when the address came back in another language.
  const existing = stops[index];
  if (existing.label === stop.label) return stops;
  const next = [...stops];
  next[index] = { ...existing, label: stop.label, address: stop.address };
  return next;
}

// 回到旅程里的某一站：直接用记下的全景和地址，不再按坐标重新查找
export function locationFromStop(stop) {
  const known = Object.fromEntries(
    Object.entries(stop.address || {}).filter(([, value]) => value),
  );
  return {
    formatted_address: stop.label,
    ...known,
    pano_id: stop.panoId,
    latitude: stop.lat,
    longitude: stop.lng,
  };
}

/**
 * Places visited in this browser tab, oldest first. Kept in sessionStorage so
 * a reload keeps the trip, while a new tab starts a new one.
 */
export default function useHomeJourney(location, language) {
  const [stops, setStops] = useState(readStoredStops);

  useEffect(() => {
    if (
      !location?.pano_id ||
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude)
    ) {
      return;
    }
    setStops((current) =>
      appendJourneyStop(current, {
        panoId: location.pano_id,
        lat: location.latitude,
        lng: location.longitude,
        label: formatAddress(location, language),
        // Raw fields let the list re-render the country in the current UI
        // language (formatAddress swaps it by country code).
        address: {
          formatted_address: location.formatted_address,
          country: location.country,
          country_code: location.country_code,
          city: location.city,
          latitude: location.latitude,
          longitude: location.longitude,
          address_language: location.address_language,
        },
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 到达新全景时记一站；当前站的地址换成新语言时只更新名字
  }, [location?.pano_id, location?.address_language]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stops));
    } catch {
      // Storage can be unavailable (private mode); the trip just won't survive a reload.
    }
  }, [stops]);

  return stops;
}
