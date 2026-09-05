export type Coordinates = { lat: number; lng: number };
export type Target = Coordinates & {
  address?: string;
  country?: string;
  panoId?: string;
  pano_id?: string;
};
export type Guess = {
  lat: number | null;
  lng: number | null;
  score: number;
  distance: number | null;
  reasoning?: string;
};
export type RoundScore = {
  playerScore: number;
  distance: number | null;
  zoomSteps: number;
  aiScore: number | null;
  aiDistance: number | null;
  locationLabel: string;
};
export type GameState = {
  phase: "WELCOME" | "LOADING" | "PLAYING" | "ROUND_RESULT" | "GAME_OVER";
  round: number;
  scores: RoundScore[];
  target: Target | null;
  zoomSteps: number;
  currentZoom: number;
  guessPin: Coordinates | null;
  guessResult: Guess | null;
  aiEnabled: boolean;
  aiGuess: Guess | null;
  aiLoading: boolean;
  roundPlan: ReturnType<
    typeof import("./geoGameUtils").generateRoundPlan
  > | null;
  countryCode: string;
  usedTargets: Target[];
};
export type GameAction =
  | { type: "START_GAME"; countryCode?: string; aiEnabled?: boolean }
  | { type: "SET_TARGET"; payload: Target }
  | { type: "PLACE_PIN"; payload: Coordinates }
  | { type: "SET_AI_GUESS"; payload: Guess | null }
  | {
      type:
        | "ZOOM_OUT"
        | "LOCK_IN"
        | "GIVE_UP"
        | "SET_AI_LOADING"
        | "NEXT_ROUND"
        | "RESTART";
    };
export type Translate = (
  key: string,
  options?: Record<string, string | number>,
) => string;
