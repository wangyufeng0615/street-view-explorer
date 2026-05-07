import React from "react";
import "../styles/GameFeedback.css";

export function GameFeedbackBubbles({ bubbles, className = "" }) {
  if (!bubbles.length) return null;

  return (
    <div
      className={`game-feedback-bubbles ${className}`}
      aria-live="polite"
      aria-atomic="false"
    >
      {bubbles.map((bubble) => (
        <div
          key={bubble.id}
          className={`game-feedback-bubble game-feedback-bubble--${bubble.tone}`}
        >
          {bubble.message}
        </div>
      ))}
    </div>
  );
}

export function GameSoundToggle({
  enabled,
  onToggle,
  enabledLabel,
  disabledLabel,
  className = "",
}) {
  const label = enabled ? enabledLabel : disabledLabel;

  return (
    <button
      type="button"
      className={`game-sound-toggle ${
        enabled ? "game-sound-toggle--on" : "game-sound-toggle--off"
      } ${className}`}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <span aria-hidden="true">♪</span>
      <span>{label}</span>
    </button>
  );
}
