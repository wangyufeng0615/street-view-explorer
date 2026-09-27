import { useCallback, useEffect, useRef } from "react";
import { synthesizeDoubaoTTSStream } from "../services/api";
import {
  floatTo16BitPCM,
  resampleAudio,
  bytesToBase64,
  base64ToFloat32PCM,
} from "../utils/atlasVoiceAudio";
import {
  ASSISTANT_ECHO_TAIL_MS,
  REALTIME_AUDIO_MAX_BUFFERED_BYTES,
  REALTIME_AUDIO_SAMPLE_RATE,
} from "../utils/atlasVoiceConfig";
import { playDoubaoSpeechResponse } from "../utils/atlasVoiceDoubaoStream";
import {
  nextDoubaoSpeechQueue,
  shouldDropRealtimeAudioFrame,
} from "../utils/atlasVoiceRuntime";

/**
 * Owns the Atlas Voice audio graph: microphone capture, assistant PCM
 * playback, the Doubao speech queue, echo suppression and the "speech went
 * idle" check that flushes deferred session updates.
 *
 * Inputs are panel state the audio side needs to read or drive; all refs are
 * read at call time so callbacks never see stale values.
 */
export default function useAtlasVoiceAudio({
  locale,
  copy,
  setStatus,
  setError,
  statusRef,
  voiceConfigRef,
  deferredSessionUpdateRef,
  sendEvent,
  sendSessionUpdateForCurrentContext,
}) {
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
  const assistantSpeechStartedAtRef = useRef(null);
  const assistantSpeechEndedAtRef = useRef(null);
  const speechIdleTimerRef = useRef(null);
  const scheduleSpeechIdleCheckRef = useRef(null);

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
  }, [hasAudibleAssistantSpeech, isAssistantEchoTailActive, voiceConfigRef]);

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
  }, [
    deferredSessionUpdateRef,
    hasActiveAssistantSpeech,
    sendSessionUpdateForCurrentContext,
    statusRef,
  ]);

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
  }, [
    flushDeferredSessionUpdate,
    hasActiveAssistantSpeech,
    setStatus,
    statusRef,
  ]);

  useEffect(() => {
    scheduleSpeechIdleCheckRef.current = scheduleSpeechIdleCheck;
  }, [scheduleSpeechIdleCheck]);

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

          await playDoubaoSpeechResponse(response, {
            signal: controller.signal,
            isCurrent: () => doubaoSpeechIdRef.current === generation,
            copy,
            onAudioDelta: (event) => {
              setStatus("speaking");
              playAudioDelta({
                delta: event.delta,
                item_id: `doubao-${queuedSpeech.id}`,
                content_index: 0,
                sample_rate: event.sample_rate,
              });
            },
          });
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
    copy,
    locale,
    playAudioDelta,
    scheduleSpeechIdleCheck,
    setError,
    setStatus,
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
    [
      copy.ttsMissingCredentials,
      drainDoubaoSpeechQueue,
      setError,
      setStatus,
      statusRef,
      voiceConfigRef,
    ],
  );

  /** Teardown step 1: drop queued speech, abort TTS and silence playback. */
  const resetAssistantSpeech = useCallback(() => {
    doubaoSpeechIdRef.current += 1;
    doubaoSpeechQueueRef.current = [];
    doubaoSpeechActiveRef.current = false;
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
  }, [clearAssistantPlayback]);

  /** Teardown step 2: disconnect the mic graph and close the AudioContext. */
  const releaseAudioGraph = useCallback(() => {
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
  }, []);

  return {
    assistantSpeechStartedAtRef,
    clearAssistantPlayback,
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
  };
}
