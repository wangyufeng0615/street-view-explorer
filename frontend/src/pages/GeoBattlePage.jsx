import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { GeoBattleHubPage } from "./GeoBattleHubPage";
import {
  GeoBattleRoomTopBar,
  GeoBattleStatusBar,
} from "../components/GeoBattleRoomHeader";
import { GeoBattleSatellitePanel } from "../components/GeoBattleSatellitePanel";
import { GeoBattleMapPanel } from "../components/GeoBattleMapPanel";
import { GameFeedbackBubbles } from "../components/GameFeedback";
import { useGameFeedback } from "../hooks/useGameFeedback";
import {
  useGeoBattleGuessMap,
  useGeoBattleGuessMapHandles,
} from "../hooks/useGeoBattleGuessMap";
import { useGeoBattleRoomActions } from "../hooks/useGeoBattleRoomActions";
import { useGeoBattleRoomFeedback } from "../hooks/useGeoBattleRoomFeedback";
import { useGeoBattleRoomSync } from "../hooks/useGeoBattleRoomSync";
import { useGeoBattleSatelliteImage } from "../hooks/useGeoBattleSatelliteImage";
import { loadNotoSerifSC } from "../utils/pageFonts";
import "../styles/GeoBattle.css";

// Hook call order below mirrors the original single-component effect order:
// feedback -> room sync (ticker, reset, load, visibility, deadline, polling)
// -> guess map (load, create, resize, pending pin, round reset, results) ->
// transition feedback -> satellite image. Keep it when editing; the guess map
// round reset must stay before its result overlays.
function GeoBattleRoomPage({ roomId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    bubbles: feedbackBubbles,
    showFeedbackBubble,
    playFeedback,
    soundEnabled,
    toggleSound,
  } = useGameFeedback({ storageKey: "geoBattleSound" });
  const feedbackRef = useRef({ showFeedbackBubble, playFeedback, t });
  feedbackRef.current = { showFeedbackBubble, playFeedback, t };

  const [guessPin, setGuessPin] = useState(null);
  const mapHandles = useGeoBattleGuessMapHandles();
  const { clearPendingMarker, clearResultOverlays, resetMapViewport } =
    mapHandles;

  const resetGuessState = useCallback(() => {
    setGuessPin(null);
    clearPendingMarker();
    clearResultOverlays();
    resetMapViewport();
  }, [clearPendingMarker, clearResultOverlays, resetMapViewport]);

  const {
    room,
    roomRef,
    fatalError,
    actionError,
    setActionError,
    actionNotice,
    setActionNotice,
    syncFailures,
    remainingSeconds,
    applyRoomResponse,
  } = useGeoBattleRoomSync({ roomId, t, onRoomReset: resetGuessState });

  const { mapsReady, mapReady, mapsError } = useGeoBattleGuessMap({
    handles: mapHandles,
    room,
    roomRef,
    guessPin,
    setGuessPin,
    feedbackRef,
    t,
  });

  useGeoBattleRoomFeedback({ room, playFeedback, showFeedbackBubble, t });

  const {
    actionBusy,
    handleReadyToggle,
    handleZoomOut,
    handleSubmitGuess,
    handleGiveUp,
    handleLeaveRoom,
    handleCopyCode,
  } = useGeoBattleRoomActions({
    room,
    guessPin,
    setGuessPin,
    applyRoomResponse,
    setActionError,
    setActionNotice,
    playFeedback,
    showFeedbackBubble,
    navigate,
    t,
  });

  const image = useGeoBattleSatelliteImage({
    room,
    feedbackRef,
    playFeedback,
    showFeedbackBubble,
    t,
  });

  if (fatalError && !room) {
    return (
      <div className="geo-battle-page">
        <div className="geo-battle-shell geo-battle-shell--error">
          <div className="geo-battle-title">{t("geo_online.room_missing")}</div>
          <div className="geo-battle-banner">{fatalError}</div>
          <button
            type="button"
            className="geo-battle-primary-btn"
            onClick={() => navigate("/guess/online")}
          >
            {t("geo_online.return_lobby")}
          </button>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="geo-battle-page">
        <div className="geo-battle-shell geo-battle-shell--loading">
          <div className="geo-battle-title">{t("geo_online.loading_room")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="geo-battle-page">
      <div className="geo-battle-shell">
        <GeoBattleRoomTopBar
          room={room}
          syncFailures={syncFailures}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          onLeave={handleLeaveRoom}
          onCopyCode={handleCopyCode}
          t={t}
        />

        <GeoBattleStatusBar
          room={room}
          remainingSeconds={remainingSeconds}
          t={t}
        />

        {(actionError || fatalError) && (
          <div className="geo-battle-banner">{actionError || fatalError}</div>
        )}
        {actionNotice && (
          <div className="geo-battle-notice">{actionNotice}</div>
        )}

        <div className="geo-battle-board">
          <GeoBattleSatellitePanel
            room={room}
            image={image}
            actionBusy={actionBusy}
            onZoomOut={handleZoomOut}
            t={t}
          />

          <GeoBattleMapPanel
            room={room}
            guessMapElRef={mapHandles.guessMapElRef}
            mapsReady={mapsReady}
            mapReady={mapReady}
            mapsError={mapsError}
            guessPin={guessPin}
            actionBusy={actionBusy}
            imageInteractionPending={image.imageInteractionPending}
            remainingSeconds={remainingSeconds}
            onReadyToggle={handleReadyToggle}
            onLeave={handleLeaveRoom}
            onSubmitGuess={handleSubmitGuess}
            onGiveUp={handleGiveUp}
            t={t}
          />
        </div>
      </div>
      <GameFeedbackBubbles bubbles={feedbackBubbles} />
    </div>
  );
}

export default function GeoBattlePage() {
  const { roomId } = useParams();

  useEffect(() => {
    loadNotoSerifSC();
  }, []);

  if (roomId) {
    return <GeoBattleRoomPage roomId={roomId} />;
  }

  return <GeoBattleHubPage />;
}
