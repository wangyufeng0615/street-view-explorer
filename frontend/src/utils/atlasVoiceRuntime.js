export const MIC_AUDIO_CONSTRAINTS = Object.freeze({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
});

const DEFAULT_REALTIME_AUDIO_MAX_BUFFERED_BYTES = 128 * 1024;

export function realtimeAudioMaxBufferedBytes(env = {}) {
  return Math.max(
    16 * 1024,
    parseEnvInteger(
      env.VITE_REALTIME_AUDIO_MAX_BUFFERED_BYTES,
      DEFAULT_REALTIME_AUDIO_MAX_BUFFERED_BYTES,
    ),
  );
}

export function shouldDropRealtimeAudioFrame({
  bufferedAmount = 0,
  maxBufferedBytes = DEFAULT_REALTIME_AUDIO_MAX_BUFFERED_BYTES,
} = {}) {
  return Number(bufferedAmount || 0) > Number(maxBufferedBytes || 0);
}

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
  const heading = quantizedHeading(context.heading || 0);

  return JSON.stringify({
    panoId: location?.pano_id || location?.panoId || "",
    lat: Number.isFinite(Number(location?.latitude))
      ? Number(location.latitude).toFixed(5)
      : "",
    lng: Number.isFinite(Number(location?.longitude))
      ? Number(location.longitude).toFixed(5)
      : "",
    heading,
    description: description
      ? `${description.length}:${description.slice(0, 160)}`
      : "",
  });
}

export function resolveStreetViewScene({
  location,
  streetViewView,
  heading = 0,
} = {}) {
  const panoId = String(
    streetViewView?.panoId || location?.pano_id || location?.panoId || "",
  ).trim();
  if (!panoId) return null;

  const numeric = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    panoId,
    heading: ((numeric(streetViewView?.heading, heading) % 360) + 360) % 360,
    pitch: Math.max(-90, Math.min(90, numeric(streetViewView?.pitch, 0))),
    fov: Math.max(10, Math.min(120, numeric(streetViewView?.fov, 90))),
    source: streetViewView?.source || "initial",
  };
}

export function buildStreetViewSceneSignature(scene) {
  if (!scene?.panoId) return "";
  const quantize = (value, step) =>
    Math.round(Number(value || 0) / step) * step;
  return [
    scene.panoId,
    quantize(scene.heading, 5),
    quantize(scene.pitch, 5),
    Math.round(scene.fov),
  ].join(":");
}

export function buildRealtimeSceneContextEvent({
  itemId,
  imageDataUrl,
  scene,
}) {
  return {
    type: "conversation.item.create",
    item: {
      id: itemId,
      type: "message",
      role: "user",
      content: [
        {
          type: "input_image",
          image_url: imageDataUrl,
          detail: "high",
        },
        {
          type: "input_text",
          text: `Silent current Street View context. Heading ${Math.round(
            scene.heading,
          )}°, pitch ${Math.round(scene.pitch)}°, field of view ${Math.round(
            scene.fov,
          )}°. Observe it now, but do not respond until the user speaks.`,
        },
      ],
    },
  };
}

function quantizedHeading(heading) {
  const numeric = Number(heading);
  if (!Number.isFinite(numeric)) return 0;
  const quantized = Math.round(numeric / 15) * 15;
  return ((quantized % 360) + 360) % 360;
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
  return (
    nowMs - assistantSpeechStartedAtMs >= 0 &&
    nowMs - assistantSpeechStartedAtMs < guardMs
  );
}

export function nextDoubaoSpeechQueue(_currentQueue, nextSpeech) {
  return nextSpeech?.text ? [nextSpeech] : [];
}

function normalizeEagerness(value) {
  switch (
    String(value || "high")
      .trim()
      .toLowerCase()
  ) {
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
