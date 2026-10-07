import { TOOL_DEFINITIONS } from "./atlasVoiceTools";
import { buildAtlasVoiceInstructions } from "./atlasPersona";
import {
  buildRealtimeTurnDetection,
  realtimeAudioMaxBufferedBytes,
} from "./atlasVoiceRuntime";

export const REALTIME_CALLS_URL = "/api/v1/realtime/calls";
export const REALTIME_WS_PATH = "/api/v1/realtime/ws";
export const REALTIME_TRANSPORT =
  import.meta.env.VITE_REALTIME_TRANSPORT || "backend-ws";
export const REALTIME_AUDIO_SAMPLE_RATE = 24000;
export const REALTIME_AUDIO_MAX_BUFFERED_BYTES = realtimeAudioMaxBufferedBytes(
  import.meta.env,
);
export const REALTIME_TRANSCRIPTION_MODEL =
  import.meta.env.VITE_REALTIME_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
export const REALTIME_VOICE = import.meta.env.VITE_REALTIME_VOICE || "cedar";
export const REALTIME_OUTPUT_SPEED =
  Number.parseFloat(import.meta.env.VITE_REALTIME_OUTPUT_SPEED || "1") || 1;
export const REALTIME_TURN_DETECTION = buildRealtimeTurnDetection(
  import.meta.env,
);
export const REALTIME_RESPONSE_WATCHDOG_MS = Math.max(
  4000,
  Number.parseInt(
    import.meta.env.VITE_REALTIME_RESPONSE_WATCHDOG_MS || "9000",
    10,
  ) || 9000,
);
export const ASSISTANT_ECHO_TAIL_MS = Math.max(
  0,
  Number.parseInt(import.meta.env.VITE_ASSISTANT_ECHO_TAIL_MS || "450", 10) ||
    450,
);
export const VOICE_PROVIDER_OVERRIDE =
  import.meta.env.VITE_ATLAS_VOICE_PROVIDER || "";

export const DEFAULT_VOICE_CONFIG = Object.freeze({
  provider: "openai",
  doubao_configured: false,
  doubao_format: "pcm",
  doubao_sample_rate: REALTIME_AUDIO_SAMPLE_RATE,
});

export const TEXT = {
  zh: {
    title: "语音模式",
    start: "开始",
    stop: "停止",
    connecting: "正在连接 Atlas...",
    connected: "可以说话了",
    idle: "语音未开启",
    listening: "正在听",
    thinking: "正在想",
    speaking: "正在说",
    tool: "正在行动",
    tokenError: "无法创建语音会话",
    micError: "无法访问麦克风",
    openaiError: "Realtime 连接失败",
    ttsError: "豆包语音合成失败",
    ttsMissingCredentials: "豆包发声还没配置好，我先保留文字回复。",
    responseTimeout: "我这边刚刚好像卡了一下，你再说一遍试试。",
    noLocation: "当前还没有加载地点。",
  },
  en: {
    title: "Atlas Voice",
    start: "Start",
    stop: "Stop",
    connecting: "Connecting Atlas...",
    connected: "Ready to talk",
    idle: "Voice off",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    tool: "Taking action",
    tokenError: "Could not create voice session",
    micError: "Could not access microphone",
    openaiError: "Realtime connection failed",
    ttsError: "Doubao speech synthesis failed",
    ttsMissingCredentials:
      "Doubao speech is not configured yet, so I kept the text reply.",
    responseTimeout: "I think I got stuck for a second. Say that again?",
    noLocation: "No location is loaded yet.",
  },
};

export function getLocale(language) {
  return (language || "en").startsWith("zh") ? "zh" : "en";
}

export function normalizeVoiceProvider(provider) {
  return String(provider || "openai").toLowerCase() === "doubao"
    ? "doubao"
    : "openai";
}

export function normalizeVoiceConfig(
  config,
  providerOverrideSetting = VOICE_PROVIDER_OVERRIDE,
) {
  const providerOverride = normalizeVoiceProvider(
    providerOverrideSetting || "",
  );
  const hasOverride = Boolean(providerOverrideSetting);
  return {
    ...DEFAULT_VOICE_CONFIG,
    ...(config || {}),
    provider: hasOverride
      ? providerOverride
      : normalizeVoiceProvider(config?.provider),
  };
}

export function extractAssistantText(item) {
  if (item?.type !== "message") return "";
  return (item.content || [])
    .filter((part) => part.type === "output_text" || part.type === "audio")
    .map((part) => part.text || part.transcript || "")
    .filter(Boolean)
    .join(" ");
}

export function extractToken(payload) {
  return (
    payload?.value || payload?.client_secret?.value || payload?.data?.value
  );
}

export function realtimeWebSocketURL(
  locale,
  currentLocation = window.location,
) {
  const protocol = currentLocation.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${currentLocation.host}${REALTIME_WS_PATH}?lang=${encodeURIComponent(locale)}`;
}

/**
 * Builds the Realtime `session.update` payload. Doubao speech keeps Realtime
 * text-only; OpenAI speech configures the output voice only once per session.
 */
export function buildAtlasVoiceSession({
  locale,
  state,
  memory,
  useDoubaoSpeech,
  includeOutput,
}) {
  const session = {
    type: "realtime",
    output_modalities: useDoubaoSpeech ? ["text"] : ["audio"],
    instructions: buildAtlasVoiceInstructions(locale, state, {
      memory,
    }),
    tools: TOOL_DEFINITIONS,
    tool_choice: "auto",
    audio: {
      input: {
        transcription: {
          model: REALTIME_TRANSCRIPTION_MODEL,
        },
        turn_detection: REALTIME_TURN_DETECTION,
      },
    },
  };

  if (includeOutput) {
    session.audio.output = {
      voice: REALTIME_VOICE,
      speed: REALTIME_OUTPUT_SPEED,
    };
  }
  return session;
}
