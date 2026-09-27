import { extractAssistantText } from "./atlasVoiceConfig";
import { shouldIgnoreAssistantEcho } from "./atlasVoiceRuntime";

/**
 * Applies one parsed OpenAI Realtime server event to the Atlas Voice panel.
 *
 * All panel state is reached through `ctx`: React setters, refs (read at
 * dispatch time, never cached) and the panel callbacks for playback, speech,
 * scene context and tool calls.
 */
export function dispatchAtlasRealtimeEvent(event, ctx) {
  const {
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
    openaiErrorMessage,
  } = ctx;

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
        voiceConfigRef.current?.provider === "doubao" ? "thinking" : "speaking",
      );
      break;
    case "response.output_text.delta":
      if (voiceConfigRef.current?.provider === "doubao") {
        startResponseWatchdog();
      } else {
        clearResponseWatchdog();
      }
      setStatus(
        voiceConfigRef.current?.provider === "doubao" ? "thinking" : "speaking",
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
      const text = output.map(extractAssistantText).filter(Boolean).join(" ");
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
      setError(event.error?.message || event.message || openaiErrorMessage);
      setStatus("connected");
      break;
    default:
      break;
  }
}
