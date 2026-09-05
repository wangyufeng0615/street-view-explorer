import { TOOL_DEFINITIONS } from "../utils/atlasVoiceTools";
import {
  loadVoiceMemory,
  saveVoiceMemory,
  appendVoiceMemory,
} from "../utils/atlasVoiceMemory";
import {
  normalizeHeading,
  headingFromDirection,
  destinationPoint,
  clampNumber,
  nearbyBearing,
} from "../utils/atlasVoiceNavigation";
import {
  floatTo16BitPCM,
  resampleAudio,
  bytesToBase64,
  base64ToFloat32PCM,
} from "../utils/atlasVoiceAudio";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  createRealtimeClientSecret,
  deleteExplorationPreference,
  getRealtimeVoiceConfig,
  getStreetViewFrameDataURL,
  searchLocation,
  setExplorationPreference,
  synthesizeDoubaoTTSStream,
} from "../services/api";
import useStore from "../store/useStore";
import {
  buildAtlasVoiceInstructions,
  formatAtlasLocation,
  truncateAtlasText,
} from "../utils/atlasPersona";
import {
  MIC_AUDIO_CONSTRAINTS,
  buildRealtimeTurnDetection,
  buildRealtimeSceneContextEvent,
  buildStreetViewSceneSignature,
  buildVoiceContextSignature,
  nextDoubaoSpeechQueue,
  realtimeAudioMaxBufferedBytes,
  resolveStreetViewScene,
  shouldDeferVoiceSessionUpdate,
  shouldDropRealtimeAudioFrame,
  shouldIgnoreAssistantEcho,
} from "../utils/atlasVoiceRuntime";
import "../styles/AtlasVoicePanel.css";

const REALTIME_CALLS_URL = "/api/v1/realtime/calls";
const REALTIME_WS_PATH = "/api/v1/realtime/ws";
const REALTIME_TRANSPORT =
  import.meta.env.VITE_REALTIME_TRANSPORT || "backend-ws";
const REALTIME_AUDIO_SAMPLE_RATE = 24000;
const REALTIME_AUDIO_MAX_BUFFERED_BYTES = realtimeAudioMaxBufferedBytes(
  import.meta.env,
);
const REALTIME_TRANSCRIPTION_MODEL =
  import.meta.env.VITE_REALTIME_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
const REALTIME_VOICE = import.meta.env.VITE_REALTIME_VOICE || "cedar";
const REALTIME_OUTPUT_SPEED =
  Number.parseFloat(import.meta.env.VITE_REALTIME_OUTPUT_SPEED || "1") || 1;
const REALTIME_TURN_DETECTION = buildRealtimeTurnDetection(import.meta.env);
const REALTIME_RESPONSE_WATCHDOG_MS = Math.max(
  4000,
  Number.parseInt(
    import.meta.env.VITE_REALTIME_RESPONSE_WATCHDOG_MS || "9000",
    10,
  ) || 9000,
);
const ASSISTANT_ECHO_TAIL_MS = Math.max(
  0,
  Number.parseInt(import.meta.env.VITE_ASSISTANT_ECHO_TAIL_MS || "450", 10) ||
    450,
);
const VOICE_PROVIDER_OVERRIDE =
  import.meta.env.VITE_ATLAS_VOICE_PROVIDER ||
  import.meta.env.VITE_REALTIME_AUDIO_PROVIDER ||
  "";

const DEFAULT_VOICE_CONFIG = Object.freeze({
  provider: "openai",
  doubao_configured: false,
  doubao_format: "pcm",
  doubao_sample_rate: REALTIME_AUDIO_SAMPLE_RATE,
});

const SCENE_CHANGING_ACTIONS = new Set([
  "loaded_random_location",
  "loaded_interest_location",
  "loaded_coordinates",
  "loaded_place_search",
  "wandered_nearby",
  "updated_heading",
]);

const TEXT = {
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

const MicGlyph = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
    <path d="M5 11.5a7 7 0 0 0 14 0" />
    <line x1="12" y1="18.5" x2="12" y2="21.5" />
  </svg>
);

const StopGlyph = () => (
  <svg
    width="9"
    height="9"
    viewBox="0 0 12 12"
    fill="currentColor"
    aria-hidden="true"
  >
    <rect x="1.5" y="1.5" width="9" height="9" rx="2" />
  </svg>
);

function getLocale(language) {
  return (language || "en").startsWith("zh") ? "zh" : "en";
}

function normalizeVoiceProvider(provider) {
  return String(provider || "openai").toLowerCase() === "doubao"
    ? "doubao"
    : "openai";
}

function normalizeVoiceConfig(config) {
  const providerOverride = normalizeVoiceProvider(
    VOICE_PROVIDER_OVERRIDE || "",
  );
  const hasOverride = Boolean(VOICE_PROVIDER_OVERRIDE);
  return {
    ...DEFAULT_VOICE_CONFIG,
    ...(config || {}),
    provider: hasOverride
      ? providerOverride
      : normalizeVoiceProvider(config?.provider),
  };
}

function extractAssistantText(item) {
  if (item?.type !== "message") return "";
  return (item.content || [])
    .filter((part) => part.type === "output_text" || part.type === "audio")
    .map((part) => part.text || part.transcript || "")
    .filter(Boolean)
    .join(" ");
}

function extractToken(payload) {
  return (
    payload?.value || payload?.client_secret?.value || payload?.data?.value
  );
}

function realtimeWebSocketURL(locale) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${REALTIME_WS_PATH}?lang=${encodeURIComponent(locale)}`;
}

export default function AtlasVoicePanel() {
  const { i18n } = useTranslation();
  const locale = getLocale(i18n.resolvedLanguage || i18n.language);
  const copy = TEXT[locale];

  const location = useStore((state) => state.location);
  const description = useStore((state) => state.description);
  const heading = useStore((state) => state.heading);
  const streetViewView = useStore((state) => state.streetViewView);
  const showToastMessage = useStore((state) => state.showToastMessage);

  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [lastAssistantText, setLastAssistantText] = useState("");
  const [voiceConfig, setVoiceConfig] = useState(() =>
    normalizeVoiceConfig(DEFAULT_VOICE_CONFIG),
  );

  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const audioSilenceRef = useRef(null);
  const audioPlaybackTimeRef = useRef(0);
  const assistantAudioSourcesRef = useRef(new Set());
  const activeAssistantAudioRef = useRef(null);
  const doubaoAbortRef = useRef(null);
  const doubaoSpeechIdRef = useRef(0);
  const doubaoSpeechItemIdRef = useRef(0);
  const doubaoSpeechQueueRef = useRef([]);
  const doubaoSpeechActiveRef = useRef(false);
  const handledCallIdsRef = useRef(new Set());
  const navigationAttemptedRef = useRef(false);
  const deferredSessionUpdateRef = useRef(false);
  const currentContextSignatureRef = useRef("");
  const sentContextSignatureRef = useRef("");
  const assistantSpeechStartedAtRef = useRef(null);
  const assistantSpeechEndedAtRef = useRef(null);
  const speechIdleTimerRef = useRef(null);
  const responseWatchdogTimerRef = useRef(null);
  const scheduleSpeechIdleCheckRef = useRef(null);
  const statusRef = useRef(status);
  const voiceConfigRef = useRef(voiceConfig);
  const memoryRef = useRef(loadVoiceMemory());
  const sessionOutputConfiguredRef = useRef(false);
  const sceneItemIdRef = useRef("");
  const sceneItemCounterRef = useRef(0);
  const sentSceneSignatureRef = useRef("");
  const sceneAbortRef = useRef(null);
  const sceneInFlightRef = useRef(null);
  const sceneDebounceTimerRef = useRef(null);

  const currentContext = useMemo(
    () => ({ location, description, heading, streetViewView }),
    [description, heading, location, streetViewView],
  );
  const contextSignature = useMemo(
    () => buildVoiceContextSignature(currentContext),
    [currentContext],
  );
  const sceneContext = useMemo(
    () => resolveStreetViewScene({ location, streetViewView, heading }),
    [heading, location, streetViewView],
  );
  const sceneSignature = useMemo(
    () => buildStreetViewSceneSignature(sceneContext),
    [sceneContext],
  );
  const sceneSource = sceneContext?.source || "initial";

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    currentContextSignatureRef.current = contextSignature;
  }, [contextSignature]);

  useEffect(() => {
    voiceConfigRef.current = voiceConfig;
  }, [voiceConfig]);

  const applyVoiceConfig = useCallback((config) => {
    const normalized = normalizeVoiceConfig(config);
    voiceConfigRef.current = normalized;
    setVoiceConfig(normalized);
    return normalized;
  }, []);

  const loadVoiceConfig = useCallback(async () => {
    const result = await getRealtimeVoiceConfig();
    if (result.success && result.data) {
      return applyVoiceConfig(result.data);
    }
    return applyVoiceConfig(voiceConfigRef.current || DEFAULT_VOICE_CONFIG);
  }, [applyVoiceConfig]);

  const clearAssistantPlayback = useCallback(() => {
    if (speechIdleTimerRef.current) {
      window.clearTimeout(speechIdleTimerRef.current);
      speechIdleTimerRef.current = null;
    }
    const audioContext = audioContextRef.current;
    const activeAudio = activeAssistantAudioRef.current;
    const now = audioContext?.currentTime || 0;
    const hadAssistantAudio =
      assistantAudioSourcesRef.current.size > 0 ||
      Boolean(activeAudio) ||
      audioPlaybackTimeRef.current > now + 0.05;
    let audioEndMs = 0;

    if (
      activeAudio?.startedAt !== null &&
      Number.isFinite(activeAudio?.startedAt)
    ) {
      const playedUntil = Math.min(now, activeAudio.scheduledUntil || now);
      audioEndMs = Math.max(
        0,
        Math.floor((playedUntil - activeAudio.startedAt) * 1000),
      );
    }

    assistantAudioSourcesRef.current.forEach((source) => {
      try {
        source.onended = null;
        source.stop(0);
      } catch (err) {
        // Already stopped or not yet startable; either way it is no longer part of this turn.
      }
      try {
        source.disconnect();
      } catch (err) {
        // Ignore disconnect races from sources that have already ended.
      }
    });
    assistantAudioSourcesRef.current.clear();
    activeAssistantAudioRef.current = null;
    assistantSpeechStartedAtRef.current = null;
    assistantSpeechEndedAtRef.current = hadAssistantAudio
      ? performance.now()
      : null;
    audioPlaybackTimeRef.current = now;

    return { activeAudio, audioEndMs };
  }, []);

  const stopDoubaoSpeech = useCallback(() => {
    doubaoSpeechIdRef.current += 1;
    doubaoSpeechQueueRef.current = [];
    doubaoSpeechActiveRef.current = false;
    if (doubaoAbortRef.current) {
      doubaoAbortRef.current.abort();
      doubaoAbortRef.current = null;
    }
    clearAssistantPlayback();
  }, [clearAssistantPlayback]);

  const clearResponseWatchdog = useCallback(() => {
    if (responseWatchdogTimerRef.current) {
      window.clearTimeout(responseWatchdogTimerRef.current);
      responseWatchdogTimerRef.current = null;
    }
  }, []);

  const startResponseWatchdog = useCallback(() => {
    clearResponseWatchdog();
    responseWatchdogTimerRef.current = window.setTimeout(() => {
      responseWatchdogTimerRef.current = null;
      if (
        statusRef.current === "thinking" ||
        statusRef.current === "listening"
      ) {
        setError(copy.responseTimeout);
        setStatus("connected");
      }
    }, REALTIME_RESPONSE_WATCHDOG_MS);
  }, [clearResponseWatchdog, copy.responseTimeout]);

  const rememberLine = useCallback((speaker, text) => {
    const nextMemory = appendVoiceMemory(memoryRef.current, speaker, text);
    memoryRef.current = nextMemory;
    saveVoiceMemory(nextMemory);
  }, []);

  const sendEvent = useCallback((event) => {
    const channel = channelRef.current;
    const payload = JSON.stringify(event);
    if (channel && channel.readyState === "open") {
      channel.send(payload);
      return true;
    }

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
      return true;
    }
    return false;
  }, []);

  const sendLatestSceneContext = useCallback(
    async ({ allowAuto = false } = {}) => {
      const state = useStore.getState();
      const scene = resolveStreetViewScene({
        location: state.location || state.currentLocationRef,
        streetViewView: state.streetViewView,
        heading: state.heading,
      });
      const signature = buildStreetViewSceneSignature(scene);
      if (!scene || !signature) return false;
      if (!allowAuto && scene.source === "auto" && sceneItemIdRef.current) {
        return sentSceneSignatureRef.current === signature;
      }
      if (
        sentSceneSignatureRef.current === signature &&
        sceneItemIdRef.current
      ) {
        return true;
      }

      if (sceneInFlightRef.current?.signature === signature) {
        return sceneInFlightRef.current.promise;
      }

      const promise = (async () => {
        sceneAbortRef.current?.abort();
        const controller = new AbortController();
        sceneAbortRef.current = controller;
        const frame = await getStreetViewFrameDataURL(
          scene.panoId,
          scene,
          controller.signal,
        );
        if (controller.signal.aborted || !frame.success || !frame.data) {
          if (
            !controller.signal.aborted &&
            sceneItemIdRef.current &&
            sentSceneSignatureRef.current !== signature
          ) {
            sendEvent({
              type: "conversation.item.delete",
              item_id: sceneItemIdRef.current,
            });
            sceneItemIdRef.current = "";
            sentSceneSignatureRef.current = "";
          }
          return false;
        }

        const latestState = useStore.getState();
        const latestScene = resolveStreetViewScene({
          location: latestState.location || latestState.currentLocationRef,
          streetViewView: latestState.streetViewView,
          heading: latestState.heading,
        });
        if (buildStreetViewSceneSignature(latestScene) !== signature) {
          return false;
        }

        sceneItemCounterRef.current += 1;
        const nextItemId = `atlas_scene_${Date.now()}_${sceneItemCounterRef.current}`;
        const previousItemId = sceneItemIdRef.current;
        const didSend = sendEvent(
          buildRealtimeSceneContextEvent({
            itemId: nextItemId,
            imageDataUrl: frame.data,
            scene,
          }),
        );
        if (!didSend) return false;

        sceneItemIdRef.current = nextItemId;
        sentSceneSignatureRef.current = signature;
        if (previousItemId) {
          sendEvent({
            type: "conversation.item.delete",
            item_id: previousItemId,
          });
        }
        return true;
      })();

      sceneInFlightRef.current = { signature, promise };
      try {
        return await promise;
      } finally {
        if (sceneInFlightRef.current?.promise === promise) {
          sceneInFlightRef.current = null;
        }
      }
    },
    [sendEvent],
  );

  const truncateAssistantPlayback = useCallback(() => {
    const { activeAudio, audioEndMs } = clearAssistantPlayback();
    if (!activeAudio?.itemId) return;

    sendEvent({
      type: "conversation.item.truncate",
      item_id: activeAudio.itemId,
      content_index: activeAudio.contentIndex || 0,
      audio_end_ms: audioEndMs,
    });
  }, [clearAssistantPlayback, sendEvent]);

  const sendSessionUpdate = useCallback(() => {
    const state = useStore.getState();
    const useDoubaoSpeech = voiceConfigRef.current?.provider === "doubao";
    const includeOutput =
      !useDoubaoSpeech && !sessionOutputConfiguredRef.current;
    const session = {
      type: "realtime",
      output_modalities: useDoubaoSpeech ? ["text"] : ["audio"],
      instructions: buildAtlasVoiceInstructions(locale, state, {
        memory: memoryRef.current,
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

    const didSend = sendEvent({
      type: "session.update",
      session,
    });

    if (didSend && includeOutput) {
      sessionOutputConfiguredRef.current = true;
    }
    return didSend;
  }, [locale, sendEvent]);

  const sendSessionUpdateForCurrentContext = useCallback(() => {
    const didSend = sendSessionUpdate();
    if (didSend) {
      sentContextSignatureRef.current = currentContextSignatureRef.current;
      deferredSessionUpdateRef.current = false;
    }
    return didSend;
  }, [sendSessionUpdate]);

  const hasActiveAssistantSpeech = useCallback(() => {
    const audioContext = audioContextRef.current;
    const now = audioContext?.currentTime || 0;
    return (
      doubaoSpeechActiveRef.current ||
      doubaoSpeechQueueRef.current.length > 0 ||
      assistantAudioSourcesRef.current.size > 0 ||
      audioPlaybackTimeRef.current > now + 0.05
    );
  }, []);

  const hasAudibleAssistantSpeech = useCallback(() => {
    const audioContext = audioContextRef.current;
    const now = audioContext?.currentTime || 0;
    return (
      assistantAudioSourcesRef.current.size > 0 ||
      audioPlaybackTimeRef.current > now + 0.05
    );
  }, []);

  const isAssistantEchoTailActive = useCallback(() => {
    if (!assistantSpeechEndedAtRef.current) return false;
    return (
      performance.now() - assistantSpeechEndedAtRef.current <
      ASSISTANT_ECHO_TAIL_MS
    );
  }, []);

  const shouldSuppressMicForAssistantEcho = useCallback(() => {
    return (
      voiceConfigRef.current?.provider === "doubao" &&
      (hasAudibleAssistantSpeech() || isAssistantEchoTailActive())
    );
  }, [hasAudibleAssistantSpeech, isAssistantEchoTailActive]);

  const flushDeferredSessionUpdate = useCallback(() => {
    if (!deferredSessionUpdateRef.current || hasActiveAssistantSpeech()) {
      return;
    }
    if (
      statusRef.current !== "connected" &&
      statusRef.current !== "listening"
    ) {
      return;
    }
    deferredSessionUpdateRef.current = false;
    sendSessionUpdateForCurrentContext();
  }, [hasActiveAssistantSpeech, sendSessionUpdateForCurrentContext]);

  const scheduleSpeechIdleCheck = useCallback(() => {
    if (speechIdleTimerRef.current) {
      window.clearTimeout(speechIdleTimerRef.current);
      speechIdleTimerRef.current = null;
    }

    const audioContext = audioContextRef.current;
    const now = audioContext?.currentTime || 0;
    const delayMs = Math.max(
      80,
      Math.ceil(Math.max(0, audioPlaybackTimeRef.current - now) * 1000) + 80,
    );

    speechIdleTimerRef.current = window.setTimeout(() => {
      speechIdleTimerRef.current = null;
      if (hasActiveAssistantSpeech()) {
        scheduleSpeechIdleCheckRef.current?.();
        return;
      }
      if (statusRef.current !== "idle" && statusRef.current !== "tool") {
        setStatus("connected");
      }
      flushDeferredSessionUpdate();
    }, delayMs);
  }, [flushDeferredSessionUpdate, hasActiveAssistantSpeech]);

  useEffect(() => {
    scheduleSpeechIdleCheckRef.current = scheduleSpeechIdleCheck;
  }, [scheduleSpeechIdleCheck]);

  useEffect(() => {
    if (status === "idle") return;

    const hasActiveSpeech = hasActiveAssistantSpeech();
    if (
      shouldDeferVoiceSessionUpdate({
        status,
        hasActiveSpeech,
        contextSignature,
        sentContextSignature: sentContextSignatureRef.current,
        pendingSessionUpdate: deferredSessionUpdateRef.current,
      })
    ) {
      deferredSessionUpdateRef.current = true;
      return;
    }
    if (status === "connected" || status === "listening") {
      if (
        deferredSessionUpdateRef.current ||
        contextSignature !== sentContextSignatureRef.current
      ) {
        sendSessionUpdateForCurrentContext();
      }
    }
  }, [
    contextSignature,
    hasActiveAssistantSpeech,
    sendSessionUpdateForCurrentContext,
    status,
  ]);

  useEffect(() => {
    if (
      !sceneSignature ||
      status === "idle" ||
      status === "connecting" ||
      (sceneSource === "auto" && sceneItemIdRef.current)
    ) {
      return undefined;
    }

    if (sceneDebounceTimerRef.current) {
      window.clearTimeout(sceneDebounceTimerRef.current);
    }
    sceneDebounceTimerRef.current = window.setTimeout(
      () => {
        sceneDebounceTimerRef.current = null;
        void sendLatestSceneContext();
      },
      sceneSource === "initial" ? 0 : 850,
    );

    return () => {
      if (sceneDebounceTimerRef.current) {
        window.clearTimeout(sceneDebounceTimerRef.current);
        sceneDebounceTimerRef.current = null;
      }
    };
  }, [sceneSignature, sceneSource, sendLatestSceneContext, status]);

  const cleanupConnection = useCallback(() => {
    doubaoSpeechIdRef.current += 1;
    doubaoSpeechQueueRef.current = [];
    doubaoSpeechActiveRef.current = false;
    clearResponseWatchdog();
    deferredSessionUpdateRef.current = false;
    currentContextSignatureRef.current = "";
    sentContextSignatureRef.current = "";
    assistantSpeechStartedAtRef.current = null;
    assistantSpeechEndedAtRef.current = null;
    if (speechIdleTimerRef.current) {
      window.clearTimeout(speechIdleTimerRef.current);
      speechIdleTimerRef.current = null;
    }
    if (doubaoAbortRef.current) {
      doubaoAbortRef.current.abort();
      doubaoAbortRef.current = null;
    }
    clearAssistantPlayback();
    sessionOutputConfiguredRef.current = false;
    sceneAbortRef.current?.abort();
    sceneAbortRef.current = null;
    sceneInFlightRef.current = null;
    if (sceneDebounceTimerRef.current) {
      window.clearTimeout(sceneDebounceTimerRef.current);
      sceneDebounceTimerRef.current = null;
    }
    sceneItemIdRef.current = "";
    sentSceneSignatureRef.current = "";

    const channel = channelRef.current;
    if (channel) {
      channel.close();
      channelRef.current = null;
    }

    const socket = socketRef.current;
    if (socket) {
      socket.close();
      socketRef.current = null;
    }

    const peer = peerRef.current;
    if (peer) {
      peer.getSenders().forEach((sender) => {
        if (sender.track) sender.track.stop();
      });
      peer.close();
      peerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }

    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }
    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (audioSilenceRef.current) {
      audioSilenceRef.current.disconnect();
      audioSilenceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    audioPlaybackTimeRef.current = 0;

    handledCallIdsRef.current.clear();
    navigationAttemptedRef.current = false;
  }, [clearAssistantPlayback, clearResponseWatchdog]);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      audioContextRef.current = new AudioContextCtor();
    }
    return audioContextRef.current;
  }, []);

  const startMicrophoneStreaming = useCallback(
    async (stream, socket) => {
      const audioContext = getAudioContext();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silence = audioContext.createGain();
      silence.gain.value = 0;

      processor.onaudioprocess = (event) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        if (shouldSuppressMicForAssistantEcho()) return;
        if (
          shouldDropRealtimeAudioFrame({
            bufferedAmount: socket.bufferedAmount,
            maxBufferedBytes: REALTIME_AUDIO_MAX_BUFFERED_BYTES,
          })
        ) {
          return;
        }
        const input = event.inputBuffer.getChannelData(0);
        const resampled = resampleAudio(
          input,
          audioContext.sampleRate,
          REALTIME_AUDIO_SAMPLE_RATE,
        );
        socket.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: bytesToBase64(floatTo16BitPCM(resampled)),
          }),
        );
      };

      source.connect(processor);
      processor.connect(silence);
      silence.connect(audioContext.destination);

      audioSourceRef.current = source;
      audioProcessorRef.current = processor;
      audioSilenceRef.current = silence;
    },
    [getAudioContext, shouldSuppressMicForAssistantEcho],
  );

  const playAudioDelta = useCallback(
    (event) => {
      const delta = event?.delta;
      if (!delta) return;
      const audioContext = getAudioContext();
      const samples = base64ToFloat32PCM(delta);
      const sampleRate =
        Number(event.sample_rate) || REALTIME_AUDIO_SAMPLE_RATE;
      const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);

      const startAt = Math.max(
        audioContext.currentTime,
        audioPlaybackTimeRef.current,
      );
      const scheduledUntil = startAt + buffer.duration;
      const itemId = event.item_id || event.item?.id || null;
      const contentIndex = Number.isInteger(event.content_index)
        ? event.content_index
        : 0;
      const playbackWasIdle =
        assistantAudioSourcesRef.current.size === 0 &&
        audioPlaybackTimeRef.current <= audioContext.currentTime + 0.05;

      if (
        !activeAssistantAudioRef.current ||
        activeAssistantAudioRef.current.itemId !== itemId ||
        activeAssistantAudioRef.current.contentIndex !== contentIndex
      ) {
        activeAssistantAudioRef.current = {
          itemId,
          contentIndex,
          startedAt: startAt,
          scheduledUntil,
        };
      } else {
        activeAssistantAudioRef.current.scheduledUntil = Math.max(
          activeAssistantAudioRef.current.scheduledUntil,
          scheduledUntil,
        );
      }

      if (playbackWasIdle) {
        assistantSpeechStartedAtRef.current = performance.now();
        assistantSpeechEndedAtRef.current = null;
      }
      assistantAudioSourcesRef.current.add(source);
      source.onended = () => {
        assistantAudioSourcesRef.current.delete(source);
        try {
          source.disconnect();
        } catch (err) {
          // Source may already have been disconnected during an interruption.
        }
        if (
          assistantAudioSourcesRef.current.size === 0 &&
          activeAssistantAudioRef.current?.itemId === itemId
        ) {
          activeAssistantAudioRef.current = null;
          assistantSpeechStartedAtRef.current = null;
          assistantSpeechEndedAtRef.current = performance.now();
          scheduleSpeechIdleCheck();
        }
      };

      source.start(startAt);
      audioPlaybackTimeRef.current = scheduledUntil;
    },
    [getAudioContext, scheduleSpeechIdleCheck],
  );

  const drainDoubaoSpeechQueue = useCallback(async () => {
    if (doubaoSpeechActiveRef.current) return;

    doubaoSpeechActiveRef.current = true;
    const generation = doubaoSpeechIdRef.current;

    try {
      while (
        doubaoSpeechQueueRef.current.length > 0 &&
        doubaoSpeechIdRef.current === generation
      ) {
        const queuedSpeech = doubaoSpeechQueueRef.current.shift();
        if (!queuedSpeech?.text) continue;

        const controller = new AbortController();
        doubaoAbortRef.current = controller;
        setStatus("speaking");

        try {
          const response = await synthesizeDoubaoTTSStream({
            text: queuedSpeech.text,
            language: locale,
            signal: controller.signal,
          });

          if (!response.ok) {
            const body = await response.text();
            let message = body;
            try {
              const parsed = JSON.parse(body);
              message = parsed?.error || parsed?.message || body;
              if (parsed?.code === "doubao_tts_missing_credentials") {
                message = copy.ttsMissingCredentials;
              }
            } catch (err) {
              // Some upstream failures are plain text; use the cleaned fallback below.
            }
            if (/credentials/i.test(message || "")) {
              message = copy.ttsMissingCredentials;
            }
            throw new Error(message || copy.ttsError);
          }
          if (!response.body) {
            throw new Error(copy.ttsError);
          }

          const reader = response.body.getReader();
          const cancelReader = () => {
            reader.cancel().catch(() => {});
          };
          controller.signal.addEventListener("abort", cancelReader, {
            once: true,
          });
          if (controller.signal.aborted) cancelReader();
          try {
            const decoder = new TextDecoder();
            let buffer = "";

            const handleLine = (line) => {
              if (!line.trim() || doubaoSpeechIdRef.current !== generation)
                return;
              let event;
              try {
                event = JSON.parse(line);
              } catch (err) {
                return;
              }

              if (event.type === "audio_delta" && event.delta) {
                setStatus("speaking");
                playAudioDelta({
                  delta: event.delta,
                  item_id: `doubao-${queuedSpeech.id}`,
                  content_index: 0,
                  sample_rate: event.sample_rate,
                });
              } else if (event.type === "error") {
                throw new Error(event.error || copy.ttsError);
              }
            };

            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              lines.forEach(handleLine);
            }

            buffer += decoder.decode();
            if (buffer) {
              handleLine(buffer);
            }
          } finally {
            controller.signal.removeEventListener("abort", cancelReader);
            await reader.cancel().catch(() => {});
          }
        } catch (err) {
          if (
            err.name === "AbortError" ||
            doubaoSpeechIdRef.current !== generation
          ) {
            break;
          }
          setError(err.message || copy.ttsError);
          doubaoSpeechQueueRef.current = [];
          break;
        } finally {
          if (doubaoAbortRef.current === controller) {
            doubaoAbortRef.current = null;
          }
        }
      }
    } finally {
      if (doubaoSpeechIdRef.current === generation) {
        doubaoSpeechActiveRef.current = false;
        scheduleSpeechIdleCheck();
      }
    }
  }, [
    copy.ttsError,
    copy.ttsMissingCredentials,
    locale,
    playAudioDelta,
    scheduleSpeechIdleCheck,
  ]);

  const speakWithDoubao = useCallback(
    (text) => {
      const cleanText = String(text || "").trim();
      if (!cleanText) return;
      if (!voiceConfigRef.current?.doubao_configured) {
        setError(copy.ttsMissingCredentials);
        if (statusRef.current !== "idle") {
          setStatus("connected");
        }
        return;
      }

      doubaoSpeechItemIdRef.current += 1;
      doubaoSpeechQueueRef.current = nextDoubaoSpeechQueue(
        doubaoSpeechQueueRef.current,
        {
          id: doubaoSpeechItemIdRef.current,
          text: cleanText,
        },
      );
      setStatus("speaking");
      void drainDoubaoSpeechQueue();
    },
    [copy.ttsMissingCredentials, drainDoubaoSpeechQueue],
  );

  const summarizeCurrentPlace = useCallback(() => {
    const state = useStore.getState();
    const activeLocation = state.location || state.currentLocationRef;
    if (!activeLocation) {
      return {
        success: false,
        message: copy.noLocation,
      };
    }

    return {
      success: true,
      location: formatAtlasLocation(activeLocation),
      heading: Math.round(state.heading || 0),
      description: truncateAtlasText(state.description || "", 1200),
    };
  }, [copy.noLocation]);

  const executeTool = useCallback(
    async (name, args) => {
      setStatus("tool");
      const state = useStore.getState();
      const language = getLocale(i18n.resolvedLanguage || i18n.language);

      const legacyModes = {
        explore_random: "random",
        explore_interest: "theme",
        go_to_place: Number.isFinite(Number(args?.lat))
          ? "coordinates"
          : "place",
        wander_nearby: "nearby",
      };
      if (Object.prototype.hasOwnProperty.call(legacyModes, name)) {
        args = {
          ...(args || {}),
          mode: legacyModes[name],
          query: args?.query || args?.interest,
        };
        name = "navigate";
      }

      if (name === "read_current_place") {
        return summarizeCurrentPlace();
      }

      if (name === "navigate" && args?.mode === "random") {
        await deleteExplorationPreference(language);
        window.localStorage?.setItem("exploration_mode", "random");
        window.localStorage?.removeItem("exploration_interest");
        useStore.setState({
          explorationMode: "random",
          explorationInterest: "",
          preferenceError: null,
        });
        await useStore.getState().loadRandomLocation(true);
        void sendLatestSceneContext({ allowAuto: true });
        return {
          success: true,
          action: "loaded_random_location",
          ...summarizeCurrentPlace(),
        };
      }

      if (name === "navigate" && args?.mode === "theme") {
        const interest = String(args?.query || "").trim();
        if (!interest) {
          return {
            success: false,
            error: "Missing exploration theme",
            terminal: true,
            retry_allowed: false,
          };
        }

        const preference = await setExplorationPreference(interest, language);
        if (!preference.success) {
          return {
            success: false,
            error: preference.error || "Failed to set exploration preference",
            terminal: true,
            retry_allowed: false,
          };
        }

        window.localStorage?.setItem("exploration_mode", "custom");
        window.localStorage?.setItem("exploration_interest", interest);
        useStore.setState({
          explorationMode: "custom",
          explorationInterest: interest,
          preferenceError: null,
        });
        await useStore.getState().loadRandomLocation(true);
        void sendLatestSceneContext({ allowAuto: true });
        return {
          success: true,
          action: "loaded_interest_location",
          interest,
          ...summarizeCurrentPlace(),
        };
      }

      if (
        name === "navigate" &&
        ["place", "coordinates"].includes(args?.mode)
      ) {
        const lat = Number(args?.lat);
        const lng = Number(args?.lng);
        const hasCoordinates =
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180;

        if (args?.mode === "coordinates" && hasCoordinates) {
          await state.loadLocationFromURL(lat, lng);
          const nextLocation = useStore.getState().location;
          if (!nextLocation?.pano_id) {
            return {
              success: false,
              error: "Could not find Street View near those coordinates",
              terminal: true,
              retry_allowed: false,
            };
          }
          void sendLatestSceneContext({ allowAuto: true });
          return {
            success: true,
            action: "loaded_coordinates",
            ...summarizeCurrentPlace(),
          };
        }

        if (args?.mode === "coordinates") {
          return {
            success: false,
            error: "Coordinates mode requires a valid latitude and longitude.",
            terminal: true,
            retry_allowed: false,
          };
        }

        const query = String(args?.query || "").trim();
        if (!query) {
          return {
            success: false,
            error: "Provide a concrete place query or valid coordinates.",
            terminal: true,
            retry_allowed: false,
          };
        }

        const result = await searchLocation(query, language);
        if (!result.success || !result.data) {
          return {
            success: false,
            error: result.error || "Could not find that place",
            place: result.place || null,
            terminal: true,
            retry_allowed: false,
          };
        }

        const locLat = Number(result.data.latitude);
        const locLng = Number(result.data.longitude);
        if (!Number.isFinite(locLat) || !Number.isFinite(locLng)) {
          return {
            success: false,
            error: "Search returned invalid coordinates",
            terminal: true,
            retry_allowed: false,
          };
        }

        const locationData = {
          ...result.data,
          latitude: locLat,
          longitude: locLng,
        };
        useStore.setState({
          location: locationData,
          currentLocationRef: locationData,
          locationError: null,
          description: null,
          descriptionError: null,
          streetViewView: null,
        });
        void sendLatestSceneContext({ allowAuto: true });

        return {
          success: true,
          action: "loaded_place_search",
          query,
          matched_place: result.place || null,
          ...summarizeCurrentPlace(),
        };
      }

      if (name === "navigate" && args?.mode === "nearby") {
        if (!state.location) {
          return { success: false, message: copy.noLocation };
        }

        const startLat = Number(state.location.latitude);
        const startLng = Number(state.location.longitude);
        if (!Number.isFinite(startLat) || !Number.isFinite(startLng)) {
          return {
            success: false,
            error: "Current location has invalid coordinates",
          };
        }

        const distanceMeters = clampNumber(args?.distance_meters, 80, 900, 240);
        const requestedBearing = nearbyBearing(args?.direction, state.heading);
        const attempts = [
          [requestedBearing, distanceMeters],
          [normalizeHeading(requestedBearing + 35), distanceMeters * 1.5],
          [normalizeHeading(requestedBearing - 45), distanceMeters * 1.8],
        ];

        for (const [bearing, distance] of attempts) {
          const next = destinationPoint(startLat, startLng, bearing, distance);
          await useStore.getState().loadLocationFromURL(next.lat, next.lng);
          const nextLocation = useStore.getState().location;
          if (nextLocation?.pano_id) {
            void sendLatestSceneContext({ allowAuto: true });
            return {
              success: true,
              action: "wandered_nearby",
              direction: args?.direction || "forward",
              distance_meters: Math.round(distance),
              ...summarizeCurrentPlace(),
            };
          }
        }

        return {
          success: false,
          error: "Could not find nearby Street View after a few tries",
          original_location: formatAtlasLocation(state.location),
          terminal: true,
          retry_allowed: false,
        };
      }

      if (name === "navigate") {
        return {
          success: false,
          error: "Unknown navigation mode",
          terminal: true,
          retry_allowed: false,
        };
      }

      if (name === "look_direction") {
        const explicitHeading = Number(args?.heading);
        const nextHeading = Number.isFinite(explicitHeading)
          ? normalizeHeading(explicitHeading)
          : headingFromDirection(args?.direction, state.heading);

        if (nextHeading === null) {
          return {
            success: false,
            error:
              "Please provide a heading in degrees or a direction like north, east, left, right, or back.",
          };
        }

        if (typeof state.setHeading === "function") {
          state.setHeading(nextHeading);
        } else {
          useStore.setState({ heading: nextHeading });
        }
        const currentView = useStore.getState().streetViewView;
        if (currentView?.panoId) {
          useStore.getState().setStreetViewView?.({
            ...currentView,
            heading: nextHeading,
            source: "programmatic",
          });
        }
        void sendLatestSceneContext({ allowAuto: true });

        return {
          success: true,
          action: "updated_heading",
          heading: Math.round(nextHeading),
        };
      }

      return { success: false, error: `Unknown tool: ${name}` };
    },
    [
      copy.noLocation,
      i18n.language,
      i18n.resolvedLanguage,
      sendLatestSceneContext,
      summarizeCurrentPlace,
    ],
  );

  const handleFunctionCall = useCallback(
    async (functionCall) => {
      if (
        !functionCall?.call_id ||
        handledCallIdsRef.current.has(functionCall.call_id)
      ) {
        return;
      }
      handledCallIdsRef.current.add(functionCall.call_id);

      let args = {};
      try {
        args = functionCall.arguments ? JSON.parse(functionCall.arguments) : {};
      } catch (err) {
        args = {};
      }

      let output;
      const isNavigationCall = [
        "navigate",
        "explore_random",
        "explore_interest",
        "go_to_place",
        "wander_nearby",
      ].includes(functionCall.name);
      if (isNavigationCall && navigationAttemptedRef.current) {
        output = {
          success: false,
          error: "A navigation action was already attempted in this user turn.",
          terminal: true,
          retry_allowed: false,
        };
      } else {
        if (isNavigationCall) navigationAttemptedRef.current = true;
        try {
          output = await executeTool(functionCall.name, args);
        } catch (err) {
          output = {
            success: false,
            error: err.message || "Tool execution failed",
            terminal: isNavigationCall,
            retry_allowed: !isNavigationCall,
          };
        }
      }

      if (output?.success && SCENE_CHANGING_ACTIONS.has(output.action)) {
        const sceneReady = await sendLatestSceneContext({ allowAuto: true });
        output = { ...output, visual_context_ready: sceneReady };
      }

      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: functionCall.call_id,
          output: JSON.stringify(output),
        },
      });
      sendEvent({ type: "response.create" });
      setStatus("thinking");
      startResponseWatchdog();
    },
    [executeTool, sendEvent, sendLatestSceneContext, startResponseWatchdog],
  );

  const handleRealtimeEvent = useCallback(
    (rawEvent) => {
      let event;
      try {
        event = JSON.parse(rawEvent.data);
      } catch (err) {
        return;
      }

      switch (event.type) {
        case "session.created":
          setStatus("connected");
          break;
        case "input_audio_buffer.speech_started":
          navigationAttemptedRef.current = false;
          clearResponseWatchdog();
          void sendLatestSceneContext({ allowAuto: true });
          if (voiceConfigRef.current?.provider === "doubao") {
            if (
              shouldIgnoreAssistantEcho({
                provider: voiceConfigRef.current.provider,
                hasActiveSpeech: hasAudibleAssistantSpeech(),
                echoTailActive: isAssistantEchoTailActive(),
                assistantSpeechStartedAtMs: assistantSpeechStartedAtRef.current,
                nowMs: performance.now(),
              })
            ) {
              break;
            }
            stopDoubaoSpeech();
          } else {
            truncateAssistantPlayback();
          }
          setStatus("listening");
          break;
        case "input_audio_buffer.speech_stopped":
          setStatus("thinking");
          startResponseWatchdog();
          break;
        case "response.output_audio.delta":
          clearResponseWatchdog();
          if (voiceConfigRef.current?.provider !== "doubao") {
            setStatus("speaking");
            playAudioDelta(event);
          }
          break;
        case "response.audio_transcript.delta":
        case "response.output_audio_transcript.delta":
          clearResponseWatchdog();
          setStatus(
            voiceConfigRef.current?.provider === "doubao"
              ? "thinking"
              : "speaking",
          );
          break;
        case "response.output_text.delta":
          if (voiceConfigRef.current?.provider === "doubao") {
            startResponseWatchdog();
          } else {
            clearResponseWatchdog();
          }
          setStatus(
            voiceConfigRef.current?.provider === "doubao"
              ? "thinking"
              : "speaking",
          );
          break;
        case "conversation.item.input_audio_transcription.completed":
          rememberLine("User", event.transcript || "");
          break;
        case "response.output_item.done": {
          clearResponseWatchdog();
          if (event.item?.type === "function_call") {
            handleFunctionCall(event.item);
          }
          break;
        }
        case "response.done": {
          clearResponseWatchdog();
          const output = event.response?.output || [];
          const text = output
            .map(extractAssistantText)
            .filter(Boolean)
            .join(" ");
          const functionCalls = output.filter(
            (item) => item.type === "function_call",
          );
          const useDoubaoSpeech = voiceConfigRef.current?.provider === "doubao";
          if (text && functionCalls.length === 0) {
            setLastAssistantText(text);
            rememberLine("Atlas", text);
            if (useDoubaoSpeech) {
              void speakWithDoubao(text);
            }
          }
          functionCalls.forEach((item) => handleFunctionCall(item));
          if (functionCalls.length > 0) {
            break;
          }
          if (!useDoubaoSpeech && statusRef.current !== "tool") {
            setStatus("connected");
          } else if (useDoubaoSpeech && !text && statusRef.current !== "tool") {
            setStatus("connected");
          }
          break;
        }
        case "response.cancelled":
          clearResponseWatchdog();
          if (statusRef.current !== "tool") {
            setStatus("listening");
          }
          break;
        case "error":
        case "invalid_request_error":
          clearResponseWatchdog();
          setError(event.error?.message || event.message || copy.openaiError);
          setStatus("connected");
          break;
        default:
          break;
      }
    },
    [
      clearResponseWatchdog,
      copy.openaiError,
      handleFunctionCall,
      hasAudibleAssistantSpeech,
      hasActiveAssistantSpeech,
      isAssistantEchoTailActive,
      playAudioDelta,
      rememberLine,
      sendLatestSceneContext,
      speakWithDoubao,
      startResponseWatchdog,
      stopDoubaoSpeech,
      truncateAssistantPlayback,
    ],
  );

  const startVoice = useCallback(async () => {
    setError("");
    setStatus("connecting");

    try {
      await loadVoiceConfig();

      if (REALTIME_TRANSPORT === "backend-ws") {
        const socket = new WebSocket(realtimeWebSocketURL(locale));
        socketRef.current = socket;
        socket.addEventListener("message", handleRealtimeEvent);
        socket.addEventListener("close", () => {
          if (statusRef.current !== "idle") setStatus("idle");
        });

        await new Promise((resolve, reject) => {
          socket.addEventListener("open", resolve, { once: true });
          socket.addEventListener(
            "error",
            () => reject(new Error(copy.openaiError)),
            { once: true },
          );
          socket.addEventListener(
            "close",
            () => reject(new Error(copy.openaiError)),
            { once: true },
          );
        });

        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(
            MIC_AUDIO_CONSTRAINTS,
          );
        } catch (err) {
          throw new Error(copy.micError);
        }
        localStreamRef.current = stream;
        await startMicrophoneStreaming(stream, socket);

        setStatus("connected");
        sendSessionUpdateForCurrentContext();
        showToastMessage(copy.connected);
        return;
      }

      const tokenResult = await createRealtimeClientSecret(locale);
      const token = extractToken(tokenResult.data);
      if (!tokenResult.success || !token) {
        throw new Error(tokenResult.error || copy.tokenError);
      }

      const peer = new RTCPeerConnection();
      peerRef.current = peer;

      const remoteAudio = document.createElement("audio");
      remoteAudio.autoplay = true;
      remoteAudioRef.current = remoteAudio;
      peer.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch(() => {});
      };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          MIC_AUDIO_CONSTRAINTS,
        );
      } catch (err) {
        throw new Error(copy.micError);
      }
      localStreamRef.current = stream;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.addEventListener("open", () => {
        setStatus("connected");
        sendSessionUpdateForCurrentContext();
        showToastMessage(copy.connected);
      });
      channel.addEventListener("message", handleRealtimeEvent);
      channel.addEventListener("close", () => {
        if (statusRef.current !== "idle") setStatus("idle");
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        const body = await sdpResponse.text();
        throw new Error(body || copy.openaiError);
      }

      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });
    } catch (err) {
      cleanupConnection();
      setError(err.message || copy.openaiError);
      setStatus("idle");
    }
  }, [
    cleanupConnection,
    copy.connected,
    copy.micError,
    copy.openaiError,
    copy.tokenError,
    handleRealtimeEvent,
    locale,
    loadVoiceConfig,
    sendSessionUpdateForCurrentContext,
    showToastMessage,
    startMicrophoneStreaming,
  ]);

  const stopVoice = useCallback(() => {
    cleanupConnection();
    setStatus("idle");
  }, [cleanupConnection]);

  useEffect(() => {
    return () => cleanupConnection();
  }, [cleanupConnection]);

  const isActive = status !== "idle";
  const statusLabel = copy[status] || copy.idle;
  const hasVoiceLog = Boolean(lastAssistantText || error);

  return (
    <div
      className={`atlas-voice-panel atlas-voice-panel--${status}${
        hasVoiceLog ? " atlas-voice-panel--with-log" : ""
      }`}
      aria-busy={status === "thinking" || status === "tool"}
    >
      <button
        className="atlas-voice-button"
        onClick={isActive ? stopVoice : startVoice}
        disabled={status === "connecting"}
        type="button"
        aria-label={isActive ? copy.stop : copy.start}
        title={isActive ? copy.stop : copy.start}
      >
        <span className="atlas-voice-glyph" aria-hidden="true">
          {isActive ? <StopGlyph /> : <MicGlyph />}
        </span>
        <span className="atlas-voice-label" aria-live="polite">
          {isActive ? statusLabel : copy.title}
        </span>
      </button>

      {hasVoiceLog && (
        <div className="atlas-voice-log" aria-live="polite">
          {lastAssistantText && (
            <div className="atlas-voice-line assistant">
              {lastAssistantText}
            </div>
          )}
          {error && <div className="atlas-voice-line error">{error}</div>}
        </div>
      )}
    </div>
  );
}

export { TOOL_DEFINITIONS } from "../utils/atlasVoiceTools";
