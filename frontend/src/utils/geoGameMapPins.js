// Guess-map pin icons and result pin spreading for the single-player geo game.
import { haversineDistance } from "./geoGameUtils";

export const RESULT_PIN_SPREAD_DISTANCE_KM = 50;
export const RESULT_PIN_OFFSET_PX = 16;

/**
 * Google Maps marker icon for a guess pin. `headOffsetX` shifts the pin head
 * sideways while keeping the tip anchored on the real coordinate.
 */
export function createGuessPinIcon(maps, color, headOffsetX = 0) {
  const width = 74;
  const tipX = width / 2;
  const headX = tipX + headOffsetX;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="44" viewBox="0 0 ${width} 44">
      <path d="M${tipX} 42C${tipX + headOffsetX * 0.45} 38 ${headX + 14} 25.7 ${headX + 14} 15.4C${headX + 14} 7.8 ${headX + 7.7} 2 ${headX} 2C${headX - 7.7} 2 ${headX - 14} 7.8 ${headX - 14} 15.4C${headX - 14} 25.7 ${tipX - headOffsetX * 0.45} 38 ${tipX} 42Z" fill="${color}" stroke="#ffffff" stroke-width="3"/>
      <circle cx="${headX}" cy="15.5" r="5.5" fill="#ffffff" fill-opacity="0.94"/>
    </svg>
  `;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new maps.Size(width, 44),
    anchor: new maps.Point(tipX, 42),
  };
}

/**
 * Horizontal head offsets (px) for the target / player / Atlas result pins,
 * so pins that land close to the target stay distinguishable.
 */
export function getResultPinOffsets(target, guessResult, aiGuess) {
  const closePlayer =
    guessResult?.lat != null &&
    guessResult.distance <= RESULT_PIN_SPREAD_DISTANCE_KM;
  const closeAtlas =
    aiGuess &&
    haversineDistance(target.lat, target.lng, aiGuess.lat, aiGuess.lng) <=
      RESULT_PIN_SPREAD_DISTANCE_KM;

  if (closePlayer && closeAtlas) {
    return {
      target: 0,
      player: -RESULT_PIN_OFFSET_PX,
      atlas: RESULT_PIN_OFFSET_PX,
    };
  }
  if (closePlayer) {
    return {
      target: RESULT_PIN_OFFSET_PX / 2,
      player: -RESULT_PIN_OFFSET_PX / 2,
      atlas: 0,
    };
  }
  if (closeAtlas) {
    return {
      target: RESULT_PIN_OFFSET_PX / 2,
      player: 0,
      atlas: -RESULT_PIN_OFFSET_PX / 2,
    };
  }
  return { target: 0, player: 0, atlas: 0 };
}
