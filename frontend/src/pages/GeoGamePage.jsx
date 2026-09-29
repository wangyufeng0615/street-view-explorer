import React, {
  useReducer,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { initialState, reducer } from "../utils/geoGameState";
import {
  getCountryCodeFromSearch,
  getGeoLanguage,
} from "../utils/geoGameTargets";
import {
  getCurrentPlayerScore,
  getCurrentAtlasScore,
  WelcomeModal,
  GameOverModal,
} from "../components/GeoGameResults";
import GeoGameTopBar from "../components/GeoGameTopBar";
import GeoGameSatellitePanel from "../components/GeoGameSatellitePanel";
import GeoGameGuessPanel from "../components/GeoGameGuessPanel";
import { GameFeedbackBubbles } from "../components/GameFeedback";
import { useGameFeedback } from "../hooks/useGameFeedback";
import { useGeoGameSatelliteSize } from "../hooks/useGeoGameSatelliteSize";
import { useGeoGameRoundTargets } from "../hooks/useGeoGameRoundTargets";
import { useGeoGameGuessMap } from "../hooks/useGeoGameGuessMap";
import { useGeoGameSatelliteZoom } from "../hooks/useGeoGameSatelliteZoom";
import { useGeoGameAtlasGuess } from "../hooks/useGeoGameAtlasGuess";
import { useGeoGamePhaseFeedback } from "../hooks/useGeoGamePhaseFeedback";
import { loadNotoSerifSC } from "../utils/pageFonts";
import "../styles/GeoGame.css";

// ─── Component ──────────────────────────────────────────────

export default function GeoGamePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeGeoLanguage = getGeoLanguage(i18n);

  useEffect(() => {
    loadNotoSerifSC();
  }, []);
  const countryCodeFromUrl = useMemo(
    () =>
      getCountryCodeFromSearch(
        typeof window === "undefined" ? "" : window.location.search,
      ),
    [],
  );

  // Latest state for event handlers and map listeners.
  const stateRef = useRef(state);
  stateRef.current = state;

  const {
    bubbles: feedbackBubbles,
    showFeedbackBubble,
    playFeedback,
    soundEnabled,
    toggleSound,
  } = useGameFeedback({ storageKey: "geoGameSound" });

  const { satelliteElRef, satelliteImageSize } = useGeoGameSatelliteSize(
    state.phase,
  );

  const { clearPreloadedTargets } = useGeoGameRoundTargets({
    state,
    dispatch,
    language: activeGeoLanguage,
    satelliteImageSize,
  });

  const { guessMapElRef, mapsReady, mapsError, cleanupMarkers } =
    useGeoGameGuessMap({
      state,
      stateRef,
      dispatch,
      playFeedback,
      showFeedbackBubble,
      t,
    });

  const {
    satelliteUrl,
    imgLoaded,
    imgError,
    zoomTransition,
    zoomTransitionLoading,
    canZoomOut,
    handleZoomOut,
    cancelSatelliteZoomTransition,
    handleSatelliteImageLoad,
    handleSatelliteImageError,
    handleZoomTransitionAnimationEnd,
  } = useGeoGameSatelliteZoom({
    state,
    stateRef,
    dispatch,
    satelliteImageSize,
    playFeedback,
    showFeedbackBubble,
    t,
  });

  useGeoGameAtlasGuess({
    state,
    dispatch,
    satelliteImageSize,
    language: activeGeoLanguage,
  });

  useGeoGamePhaseFeedback({ state, playFeedback, showFeedbackBubble, t });

  // ─── Handlers ───
  const handleNextRound = useCallback(() => {
    // Atlas must finish (or fail/time out) first, or its round would count 0.
    if (stateRef.current.aiLoading) return;
    cleanupMarkers();
    cancelSatelliteZoomTransition();
    dispatch({ type: "NEXT_ROUND" });
  }, [cleanupMarkers, cancelSatelliteZoomTransition]);
  const handleRestart = useCallback(() => {
    cleanupMarkers();
    clearPreloadedTargets();
    cancelSatelliteZoomTransition();
    dispatch({ type: "RESTART" });
  }, [cleanupMarkers, clearPreloadedTargets, cancelSatelliteZoomTransition]);
  const handleLockIn = useCallback(() => {
    const currentState = stateRef.current;
    if (
      currentState.phase !== "PLAYING" ||
      !currentState.guessPin ||
      !currentState.target
    ) {
      return;
    }
    cancelSatelliteZoomTransition();
    playFeedback("lock");
    showFeedbackBubble(t("geo.feedback_locked"), "target");
    dispatch({ type: "LOCK_IN" });
  }, [cancelSatelliteZoomTransition, playFeedback, showFeedbackBubble, t]);
  const handleGiveUp = useCallback(() => {
    const currentState = stateRef.current;
    if (currentState.phase !== "PLAYING" || !currentState.target) return;
    cancelSatelliteZoomTransition();
    playFeedback("skip");
    showFeedbackBubble(t("geo.feedback_gave_up"), "warning");
    dispatch({ type: "GIVE_UP" });
  }, [cancelSatelliteZoomTransition, playFeedback, showFeedbackBubble, t]);
  const handleRetryTarget = useCallback(() => {
    dispatch({ type: "RETRY_TARGET" });
  }, []);
  const handleStartGame = useCallback(
    (options) => {
      clearPreloadedTargets();
      cancelSatelliteZoomTransition();
      playFeedback("ready");
      showFeedbackBubble(t("geo.feedback_game_started"), "success");
      dispatch({ type: "START_GAME", ...options });
    },
    [
      clearPreloadedTargets,
      cancelSatelliteZoomTransition,
      dispatch,
      playFeedback,
      showFeedbackBubble,
      t,
    ],
  );

  const playerScore = getCurrentPlayerScore(state);
  const atlasScore = state.aiEnabled ? getCurrentAtlasScore(state) : null;

  return (
    <div
      className={`geo-game ${
        state.phase === "WELCOME" ? "geo-game--welcome" : ""
      }`}
    >
      {state.phase === "WELCOME" ? (
        <WelcomeModal
          onStart={handleStartGame}
          t={t}
          navigate={navigate}
          countryCode={countryCodeFromUrl}
        />
      ) : (
        <>
          <GeoGameTopBar
            t={t}
            navigate={navigate}
            round={state.round}
            playerScore={playerScore}
            atlasScore={atlasScore}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
          />

          <div className="geo-main">
            <GeoGameSatellitePanel
              t={t}
              panelRef={satelliteElRef}
              phase={state.phase}
              hasTarget={Boolean(state.target)}
              targetError={state.targetError}
              onRetryTarget={handleRetryTarget}
              zoomSteps={state.zoomSteps}
              satelliteUrl={satelliteUrl}
              imgLoaded={imgLoaded}
              imgError={imgError}
              zoomTransition={zoomTransition}
              zoomTransitionLoading={zoomTransitionLoading}
              canZoomOut={canZoomOut}
              onZoomOut={handleZoomOut}
              onImageLoad={handleSatelliteImageLoad}
              onImageError={handleSatelliteImageError}
              onTransitionAnimationEnd={handleZoomTransitionAnimationEnd}
            />

            <GeoGameGuessPanel
              t={t}
              state={state}
              mapElRef={guessMapElRef}
              mapsReady={mapsReady}
              mapsError={mapsError}
              onLockIn={handleLockIn}
              onGiveUp={handleGiveUp}
              onNextRound={handleNextRound}
            />
          </div>
        </>
      )}
      {state.phase === "GAME_OVER" && (
        <GameOverModal
          state={state}
          t={t}
          onRestart={handleRestart}
          onNext={handleNextRound}
        />
      )}
      <GameFeedbackBubbles bubbles={feedbackBubbles} />
    </div>
  );
}

export { getGameOverAtlasMessage } from "../components/GeoGameResults";
