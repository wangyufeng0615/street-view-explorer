import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_BUBBLE_TTL_MS = 2400;
const MAX_VISIBLE_BUBBLES = 3;

const TONE_PATTERNS = {
  place: [{ frequency: 660, duration: 0.055, gain: 0.045 }],
  ready: [
    { frequency: 520, duration: 0.05, gain: 0.04 },
    { frequency: 720, duration: 0.08, delay: 0.045, gain: 0.04 },
  ],
  zoom: [
    {
      frequency: 360,
      endFrequency: 220,
      duration: 0.16,
      gain: 0.05,
      type: "triangle",
    },
  ],
  lock: [
    { frequency: 640, duration: 0.055, gain: 0.04 },
    { frequency: 880, duration: 0.085, delay: 0.065, gain: 0.045 },
  ],
  reveal: [
    { frequency: 523, duration: 0.055, gain: 0.04 },
    { frequency: 659, duration: 0.055, delay: 0.06, gain: 0.04 },
    { frequency: 784, duration: 0.1, delay: 0.12, gain: 0.045 },
  ],
  finish: [
    { frequency: 587, duration: 0.06, gain: 0.04 },
    { frequency: 740, duration: 0.06, delay: 0.07, gain: 0.04 },
    { frequency: 988, duration: 0.13, delay: 0.15, gain: 0.04 },
  ],
  skip: [
    {
      frequency: 280,
      endFrequency: 220,
      duration: 0.12,
      gain: 0.04,
      type: "triangle",
    },
  ],
  error: [
    {
      frequency: 190,
      endFrequency: 150,
      duration: 0.11,
      gain: 0.035,
      type: "sawtooth",
    },
    {
      frequency: 170,
      duration: 0.08,
      delay: 0.095,
      gain: 0.03,
      type: "sawtooth",
    },
  ],
};

function readStoredSoundEnabled(storageKey) {
  if (typeof window === "undefined") return true;
  try {
    if (typeof window.localStorage?.getItem !== "function") return true;
    return window.localStorage.getItem(storageKey) !== "off";
  } catch {
    return true;
  }
}

function getAudioContext(audioContextRef) {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (!audioContextRef.current) {
    audioContextRef.current = new AudioContextCtor();
  }
  return audioContextRef.current;
}

function scheduleTone(context, tone) {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const delay = tone.delay || 0;
  const duration = tone.duration || 0.08;
  const startAt = context.currentTime + delay;
  const endAt = startAt + duration;
  const gain = tone.gain || 0.04;

  oscillator.type = tone.type || "sine";
  oscillator.frequency.setValueAtTime(tone.frequency, startAt);
  if (tone.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, tone.endFrequency),
      endAt,
    );
  }

  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(gain, startAt + 0.012);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(endAt + 0.02);
}

export function useGameFeedback({ storageKey = "geoGameSound" } = {}) {
  const [soundEnabled, setSoundEnabled] = useState(() =>
    readStoredSoundEnabled(storageKey),
  );
  const [bubbles, setBubbles] = useState([]);
  const audioContextRef = useRef(null);
  const timersRef = useRef(new Map());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (typeof window.localStorage?.setItem !== "function") return;
      window.localStorage.setItem(storageKey, soundEnabled ? "on" : "off");
    } catch {
      // Storage can be unavailable in private windows or lightweight test DOMs.
    }
  }, [soundEnabled, storageKey]);

  useEffect(
    () => () => {
      timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      timersRef.current.clear();
      if (audioContextRef.current?.state !== "closed") {
        audioContextRef.current?.close?.();
      }
    },
    [],
  );

  const removeBubble = useCallback((id) => {
    const timerId = timersRef.current.get(id);
    if (timerId) {
      window.clearTimeout(timerId);
      timersRef.current.delete(id);
    }
    setBubbles((current) => current.filter((bubble) => bubble.id !== id));
  }, []);

  const showFeedbackBubble = useCallback(
    (message, tone = "info", options = {}) => {
      if (!message || typeof window === "undefined") return null;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ttl = options.ttl ?? DEFAULT_BUBBLE_TTL_MS;
      setBubbles((current) => {
        const next = [...current, { id, message, tone }];
        const visible = next.slice(-MAX_VISIBLE_BUBBLES);
        const visibleIds = new Set(visible.map((bubble) => bubble.id));
        for (const bubble of next) {
          if (visibleIds.has(bubble.id)) continue;
          const timerId = timersRef.current.get(bubble.id);
          if (timerId) {
            window.clearTimeout(timerId);
            timersRef.current.delete(bubble.id);
          }
        }
        return visible;
      });

      const timerId = window.setTimeout(() => removeBubble(id), ttl);
      timersRef.current.set(id, timerId);
      return id;
    },
    [removeBubble],
  );

  const playFeedback = useCallback(
    (type = "place") => {
      if (!soundEnabled) return;
      const context = getAudioContext(audioContextRef);
      if (!context) return;
      const pattern = TONE_PATTERNS[type] || TONE_PATTERNS.place;

      const play = () => {
        pattern.forEach((tone) => scheduleTone(context, tone));
      };

      if (context.state === "suspended") {
        context
          .resume()
          .then(play)
          .catch(() => {});
        return;
      }
      play();
    },
    [soundEnabled],
  );

  const toggleSound = useCallback(() => {
    setSoundEnabled((current) => !current);
  }, []);

  return {
    bubbles,
    showFeedbackBubble,
    playFeedback,
    soundEnabled,
    toggleSound,
  };
}
