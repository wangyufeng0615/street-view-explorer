import {
  loadVoiceMemory,
  saveVoiceMemory,
  appendVoiceMemory,
} from "../utils/atlasVoiceMemory";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { getRealtimeVoiceConfig } from "../services/api";
import useStore from "../store/useStore";
import {
  buildVoiceContextSignature,
  shouldDeferVoiceSessionUpdate,
} from "../utils/atlasVoiceRuntime";
import {
  DEFAULT_VOICE_CONFIG,
  REALTIME_RESPONSE_WATCHDOG_MS,
  REALTIME_TRANSPORT,
  TEXT,
  buildAtlasVoiceSession,
  getLocale,
  normalizeVoiceConfig,
} from "../utils/atlasVoiceConfig";
import {
  executeAtlasVoiceTool,
  handleAtlasVoiceFunctionCall,
} from "../utils/atlasVoiceToolExecutor";
import { dispatchAtlasRealtimeEvent } from "../utils/atlasVoiceRealtimeEvents";
import {
  closeRealtimeTransport,
  startBackendWebSocketVoice,
  startWebRTCVoice,
} from "../utils/atlasVoiceTransport";
import useAtlasVoiceAudio from "../hooks/useAtlasVoiceAudio";
import useAtlasVoiceSceneContext from "../hooks/useAtlasVoiceSceneContext";
import { MicGlyph, StopGlyph } from "./AtlasVoiceGlyphs";
import "../styles/AtlasVoicePanel.css";

const IDLE_LOG_HIDE_MS = 8000;

export default function AtlasVoicePanel() {
  const { i18n } = useTranslation();
  const locale = getLocale(i18n.resolvedLanguage || i18n.language);
  const copy = TEXT[locale];

  const [status, setStatus] = useState("idle");
  // 没开语音时不订阅这些字段：朝向在拖动时每秒变几十次，闲置的面板不必跟着重渲染
  const isActive = status !== "idle";
  const location = useStore((state) => (isActive ? state.location : null));
  // Hold the narration steady while it streams: every chunk would otherwise
  // change the context signature and resend the whole session.update.
  const description = useStore((state) =>
    !isActive || state.isDescriptionLoading ? "" : state.description,
  );
  const heading = useStore((state) => (isActive ? state.heading : 0));
  const streetViewView = useStore((state) =>
    isActive ? state.streetViewView : null,
  );
  const showToastMessage = useStore((state) => state.showToastMessage);

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
  const handledCallIdsRef = useRef(new Set());
  const navigationAttemptedRef = useRef(false);
  const deferredSessionUpdateRef = useRef(false);
  const currentContextSignatureRef = useRef("");
  const sentContextSignatureRef = useRef("");
  const responseWatchdogTimerRef = useRef(null);
  const statusRef = useRef(status);
  const voiceConfigRef = useRef(voiceConfig);
  const memoryRef = useRef(loadVoiceMemory());
  const sessionOutputConfiguredRef = useRef(false);
  // Bumped on every cleanup; an in-flight start compares it to know whether
  // the session it is building still exists.
  const sessionGenerationRef = useRef(0);

  const currentContext = useMemo(
    () => ({ location, description, heading, streetViewView }),
    [description, heading, location, streetViewView],
  );
  const contextSignature = useMemo(
    () => buildVoiceContextSignature(currentContext),
    [currentContext],
  );

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

  const sendSessionUpdate = useCallback(() => {
    const state = useStore.getState();
    const useDoubaoSpeech = voiceConfigRef.current?.provider === "doubao";
    const includeOutput =
      !useDoubaoSpeech && !sessionOutputConfiguredRef.current;
    const session = buildAtlasVoiceSession({
      locale,
      state,
      memory: memoryRef.current,
      useDoubaoSpeech,
      includeOutput,
    });

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

  const {
    assistantSpeechStartedAtRef,
    stopDoubaoSpeech,
    truncateAssistantPlayback,
    hasActiveAssistantSpeech,
    hasAudibleAssistantSpeech,
    isAssistantEchoTailActive,
    startMicrophoneStreaming,
    playAudioDelta,
    speakWithDoubao,
    resetAssistantSpeech,
    releaseAudioGraph,
  } = useAtlasVoiceAudio({
    locale,
    copy,
    setStatus,
    setError,
    statusRef,
    voiceConfigRef,
    deferredSessionUpdateRef,
    sendEvent,
    sendSessionUpdateForCurrentContext,
  });

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

  const { sendLatestSceneContext, resetSceneContext } =
    useAtlasVoiceSceneContext({
      sendEvent,
      status,
      location,
      streetViewView,
      heading,
    });

  const cleanupConnection = useCallback(() => {
    sessionGenerationRef.current += 1;
    resetAssistantSpeech();
    clearResponseWatchdog();
    deferredSessionUpdateRef.current = false;
    currentContextSignatureRef.current = "";
    sentContextSignatureRef.current = "";
    sessionOutputConfiguredRef.current = false;
    resetSceneContext();
    closeRealtimeTransport({
      channelRef,
      socketRef,
      peerRef,
      localStreamRef,
      remoteAudioRef,
    });
    releaseAudioGraph();

    handledCallIdsRef.current.clear();
    navigationAttemptedRef.current = false;
  }, [
    clearResponseWatchdog,
    releaseAudioGraph,
    resetAssistantSpeech,
    resetSceneContext,
  ]);

  const executeTool = useCallback(
    (name, args) => {
      setStatus("tool");
      return executeAtlasVoiceTool(name, args, {
        language: getLocale(i18n.resolvedLanguage || i18n.language),
        noLocationMessage: copy.noLocation,
        sendLatestSceneContext,
      });
    },
    [
      copy.noLocation,
      i18n.language,
      i18n.resolvedLanguage,
      sendLatestSceneContext,
    ],
  );

  const handleFunctionCall = useCallback(
    (functionCall) =>
      handleAtlasVoiceFunctionCall(functionCall, {
        handledCallIdsRef,
        navigationAttemptedRef,
        executeTool,
        sendEvent,
        sendLatestSceneContext,
        setStatus,
        startResponseWatchdog,
      }),
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

      dispatchAtlasRealtimeEvent(event, {
        setStatus,
        setError,
        setLastAssistantText,
        statusRef,
        voiceConfigRef,
        navigationAttemptedRef,
        assistantSpeechStartedAtRef,
        clearResponseWatchdog,
        startResponseWatchdog,
        sendLatestSceneContext,
        hasAudibleAssistantSpeech,
        isAssistantEchoTailActive,
        stopDoubaoSpeech,
        truncateAssistantPlayback,
        playAudioDelta,
        rememberLine,
        handleFunctionCall,
        speakWithDoubao,
        openaiErrorMessage: copy.openaiError,
      });
    },
    [
      assistantSpeechStartedAtRef,
      clearResponseWatchdog,
      copy.openaiError,
      handleFunctionCall,
      hasAudibleAssistantSpeech,
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

  // A dropped socket/data channel releases the mic and audio graph too.
  const handleTransportClosed = useCallback(() => {
    cleanupConnection();
    setStatus("idle");
  }, [cleanupConnection]);

  const startVoice = useCallback(async () => {
    // Release anything a previous session left behind before starting again.
    cleanupConnection();
    const generation = sessionGenerationRef.current;
    const isCurrent = () => sessionGenerationRef.current === generation;
    setError("");
    setStatus("connecting");

    try {
      await loadVoiceConfig();
      if (!isCurrent()) return;

      const transport = {
        locale,
        copy,
        peerRef,
        channelRef,
        socketRef,
        localStreamRef,
        remoteAudioRef,
        statusRef,
        setStatus,
        handleRealtimeEvent,
        startMicrophoneStreaming,
        sendSessionUpdateForCurrentContext,
        showToastMessage,
        isCurrent,
        onClosed: handleTransportClosed,
      };
      if (REALTIME_TRANSPORT === "backend-ws") {
        await startBackendWebSocketVoice(transport);
        return;
      }
      await startWebRTCVoice(transport);
    } catch (err) {
      // Stopped, unmounted or dropped meanwhile: that path already cleaned up.
      if (!isCurrent()) return;
      cleanupConnection();
      setError(err.message || copy.openaiError);
      setStatus("idle");
    }
  }, [
    cleanupConnection,
    copy,
    handleRealtimeEvent,
    handleTransportClosed,
    locale,
    loadVoiceConfig,
    sendSessionUpdateForCurrentContext,
    showToastMessage,
    startMicrophoneStreaming,
  ]);

  // 主动停止（包括连接中途取消）时一并收起回复记录；连接意外断开时保留错误提示
  const stopVoice = useCallback(() => {
    cleanupConnection();
    setLastAssistantText("");
    setError("");
    setStatus("idle");
  }, [cleanupConnection]);

  useEffect(() => {
    return () => cleanupConnection();
  }, [cleanupConnection]);

  // 语音已经结束（比如麦克风被拒、连接断开）时，留下的提示看一会儿就收起，不一直压在街景上
  useEffect(() => {
    if (status !== "idle" || (!error && !lastAssistantText)) return undefined;
    const timerId = window.setTimeout(() => {
      setError("");
      setLastAssistantText("");
    }, IDLE_LOG_HIDE_MS);
    return () => window.clearTimeout(timerId);
  }, [error, lastAssistantText, status]);

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
        type="button"
        aria-label={`${isActive ? copy.stop : copy.start}${locale === "zh" ? "" : " "}${copy.title}`}
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
