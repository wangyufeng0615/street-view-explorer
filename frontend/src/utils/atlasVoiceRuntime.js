export const MIC_AUDIO_CONSTRAINTS = Object.freeze({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
});

export function buildRealtimeTurnDetection(env = {}) {
  const type = String(env.VITE_REALTIME_VAD_TYPE || "semantic_vad")
    .trim()
    .toLowerCase();

  if (type === "server_vad") {
    return {
      type: "server_vad",
      threshold: clampNumber(
        parseEnvNumber(env.VITE_REALTIME_VAD_THRESHOLD, 0.5),
        0,
        1,
      ),
      prefix_padding_ms: clampNumber(
        parseEnvInteger(env.VITE_REALTIME_VAD_PREFIX_PADDING_MS, 250),
        0,
        1000,
      ),
      silence_duration_ms: clampNumber(
        parseEnvInteger(env.VITE_REALTIME_VAD_SILENCE_DURATION_MS, 350),
        100,
        2000,
      ),
      create_response: true,
      interrupt_response: true,
    };
  }

  return {
    type: "semantic_vad",
    eagerness: normalizeEagerness(env.VITE_REALTIME_VAD_EAGERNESS),
    create_response: true,
    interrupt_response: true,
  };
}

export function buildVoiceContextSignature(context = {}) {
  const location = context.location || null;
  const description = String(context.description || "");
  const heading = Number(context.heading || 0);

  return JSON.stringify({
    panoId: location?.pano_id || location?.panoId || "",
    lat: Number.isFinite(Number(location?.latitude))
      ? Number(location.latitude).toFixed(5)
      : "",
    lng: Number.isFinite(Number(location?.longitude))
      ? Number(location.longitude).toFixed(5)
      : "",
    heading: Math.round(heading),
    description: description
      ? `${description.length}:${description.slice(0, 160)}`
      : "",
  });
}

export function shouldDeferVoiceSessionUpdate({
  status,
  hasActiveSpeech,
  contextSignature,
  sentContextSignature,
  pendingSessionUpdate = false,
}) {
  const hasContextChange = contextSignature !== sentContextSignature;
  if (!pendingSessionUpdate && !hasContextChange) return false;
  return status === "speaking" || status === "tool" || Boolean(hasActiveSpeech);
}

export function shouldIgnoreAssistantEcho({
  provider,
  hasActiveSpeech,
  echoTailActive = false,
  assistantSpeechStartedAtMs,
  nowMs,
  guardMs = 650,
}) {
  if (provider !== "doubao") return false;
  if (hasActiveSpeech || echoTailActive) return true;
  if (!Number.isFinite(assistantSpeechStartedAtMs)) return false;
  return nowMs - assistantSpeechStartedAtMs >= 0 &&
    nowMs - assistantSpeechStartedAtMs < guardMs;
}

export function nextDoubaoSpeechQueue(_currentQueue, nextSpeech) {
  return nextSpeech?.text ? [nextSpeech] : [];
}

function normalizeEagerness(value) {
  switch (String(value || "high").trim().toLowerCase()) {
    case "low":
      return "low";
    case "medium":
    case "auto":
      return "medium";
    case "high":
      return "high";
    default:
      return "high";
  }
}

function parseEnvNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
