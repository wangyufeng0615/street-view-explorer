// Compile-only regression checks: each expect-error must remain an actual error.
import { initialState, reducer } from "../src/utils/geoGameState";
import { floatTo16BitPCM } from "../src/utils/atlasVoiceAudio";
import { ResultStats } from "../src/components/GeoGameResults";

reducer(initialState, { type: "PLACE_PIN", payload: { lat: 10, lng: 20 } });
// @ts-expect-error coordinates must be numeric
reducer(initialState, { type: "PLACE_PIN", payload: { lat: "10", lng: 20 } });
// @ts-expect-error unknown actions must not silently pass type checking
reducer(initialState, { type: "DELETE_GAME" });
// @ts-expect-error audio conversion requires PCM samples, not encoded text
floatTo16BitPCM("audio");
// @ts-expect-error JSX result props require a numeric score
ResultStats({ score: "5000", distance: 0, t: (key: string) => key });
