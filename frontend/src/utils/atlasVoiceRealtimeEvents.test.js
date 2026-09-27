import { describe, expect, it, vi } from "vitest";
import { dispatchAtlasRealtimeEvent } from "./atlasVoiceRealtimeEvents";

function makeCtx({ provider = "openai", status = "connected" } = {}) {
  return {
    setStatus: vi.fn(),
    setError: vi.fn(),
    setLastAssistantText: vi.fn(),
    statusRef: { current: status },
    voiceConfigRef: { current: { provider } },
    navigationAttemptedRef: { current: true },
    assistantSpeechStartedAtRef: { current: null },
    clearResponseWatchdog: vi.fn(),
    startResponseWatchdog: vi.fn(),
    sendLatestSceneContext: vi.fn().mockResolvedValue(true),
    hasAudibleAssistantSpeech: vi.fn(() => false),
    isAssistantEchoTailActive: vi.fn(() => false),
    stopDoubaoSpeech: vi.fn(),
    truncateAssistantPlayback: vi.fn(),
    playAudioDelta: vi.fn(),
    rememberLine: vi.fn(),
    handleFunctionCall: vi.fn(),
    speakWithDoubao: vi.fn(),
    openaiErrorMessage: "Realtime connection failed",
  };
}

const message = (text) => ({
  type: "message",
  content: [{ type: "output_text", text }],
});
const functionCall = (callId) => ({
  type: "function_call",
  call_id: callId,
  name: "read_current_place",
});

describe("dispatchAtlasRealtimeEvent", () => {
  it("starts a new user turn on speech_started and interrupts OpenAI playback", () => {
    const ctx = makeCtx();
    dispatchAtlasRealtimeEvent(
      { type: "input_audio_buffer.speech_started" },
      ctx,
    );

    expect(ctx.navigationAttemptedRef.current).toBe(false);
    expect(ctx.clearResponseWatchdog).toHaveBeenCalled();
    expect(ctx.sendLatestSceneContext).toHaveBeenCalledWith({
      allowAuto: true,
    });
    expect(ctx.truncateAssistantPlayback).toHaveBeenCalled();
    expect(ctx.stopDoubaoSpeech).not.toHaveBeenCalled();
    expect(ctx.setStatus).toHaveBeenCalledWith("listening");
  });

  it("ignores Doubao speaker echo but stops Doubao speech on real barge-in", () => {
    const echo = makeCtx({ provider: "doubao" });
    echo.hasAudibleAssistantSpeech.mockReturnValue(true);
    dispatchAtlasRealtimeEvent(
      { type: "input_audio_buffer.speech_started" },
      echo,
    );
    expect(echo.stopDoubaoSpeech).not.toHaveBeenCalled();
    expect(echo.setStatus).not.toHaveBeenCalled();
    // The turn still resets even when the audio is treated as echo.
    expect(echo.navigationAttemptedRef.current).toBe(false);

    const bargeIn = makeCtx({ provider: "doubao" });
    dispatchAtlasRealtimeEvent(
      { type: "input_audio_buffer.speech_started" },
      bargeIn,
    );
    expect(bargeIn.stopDoubaoSpeech).toHaveBeenCalled();
    expect(bargeIn.truncateAssistantPlayback).not.toHaveBeenCalled();
    expect(bargeIn.setStatus).toHaveBeenCalledWith("listening");
  });

  it("plays Realtime audio only when OpenAI is the voice", () => {
    const openai = makeCtx();
    const event = { type: "response.output_audio.delta", delta: "AAAA" };
    dispatchAtlasRealtimeEvent(event, openai);
    expect(openai.playAudioDelta).toHaveBeenCalledWith(event);
    expect(openai.setStatus).toHaveBeenCalledWith("speaking");

    const doubao = makeCtx({ provider: "doubao" });
    dispatchAtlasRealtimeEvent(event, doubao);
    expect(doubao.playAudioDelta).not.toHaveBeenCalled();
    expect(doubao.clearResponseWatchdog).toHaveBeenCalled();
  });

  it("keeps the watchdog armed while Doubao text is still streaming", () => {
    const doubao = makeCtx({ provider: "doubao" });
    dispatchAtlasRealtimeEvent({ type: "response.output_text.delta" }, doubao);
    expect(doubao.startResponseWatchdog).toHaveBeenCalled();
    expect(doubao.setStatus).toHaveBeenCalledWith("thinking");

    const openai = makeCtx();
    dispatchAtlasRealtimeEvent({ type: "response.output_text.delta" }, openai);
    expect(openai.clearResponseWatchdog).toHaveBeenCalled();
    expect(openai.setStatus).toHaveBeenCalledWith("speaking");
  });

  it("remembers user transcripts and hands function calls to the tool runner", () => {
    const ctx = makeCtx();
    dispatchAtlasRealtimeEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "take me to Tokyo",
      },
      ctx,
    );
    expect(ctx.rememberLine).toHaveBeenCalledWith("User", "take me to Tokyo");

    const call = functionCall("c1");
    dispatchAtlasRealtimeEvent(
      { type: "response.output_item.done", item: call },
      ctx,
    );
    dispatchAtlasRealtimeEvent(
      { type: "response.output_item.done", item: message("hi") },
      ctx,
    );
    expect(ctx.handleFunctionCall).toHaveBeenCalledTimes(1);
    expect(ctx.handleFunctionCall).toHaveBeenCalledWith(call);
  });

  it("shows and speaks final text only when the response has no tool calls", () => {
    const doubao = makeCtx({ provider: "doubao" });
    dispatchAtlasRealtimeEvent(
      { type: "response.done", response: { output: [message("Hello")] } },
      doubao,
    );
    expect(doubao.setLastAssistantText).toHaveBeenCalledWith("Hello");
    expect(doubao.rememberLine).toHaveBeenCalledWith("Atlas", "Hello");
    expect(doubao.speakWithDoubao).toHaveBeenCalledWith("Hello");
    // Doubao keeps its speaking status until playback goes idle.
    expect(doubao.setStatus).not.toHaveBeenCalled();

    const withTool = makeCtx({ provider: "doubao" });
    const call = functionCall("c2");
    dispatchAtlasRealtimeEvent(
      {
        type: "response.done",
        response: { output: [message("On my way"), call] },
      },
      withTool,
    );
    expect(withTool.setLastAssistantText).not.toHaveBeenCalled();
    expect(withTool.speakWithDoubao).not.toHaveBeenCalled();
    expect(withTool.handleFunctionCall).toHaveBeenCalledWith(call);
    expect(withTool.setStatus).not.toHaveBeenCalled();
  });

  it("returns to connected after a finished response unless a tool is running", () => {
    const openai = makeCtx();
    dispatchAtlasRealtimeEvent(
      { type: "response.done", response: { output: [message("Hi")] } },
      openai,
    );
    expect(openai.speakWithDoubao).not.toHaveBeenCalled();
    expect(openai.setStatus).toHaveBeenCalledWith("connected");

    const emptyDoubao = makeCtx({ provider: "doubao" });
    dispatchAtlasRealtimeEvent(
      { type: "response.done", response: { output: [] } },
      emptyDoubao,
    );
    expect(emptyDoubao.setStatus).toHaveBeenCalledWith("connected");

    const busy = makeCtx({ status: "tool" });
    dispatchAtlasRealtimeEvent({ type: "response.done" }, busy);
    dispatchAtlasRealtimeEvent({ type: "response.cancelled" }, busy);
    expect(busy.setStatus).not.toHaveBeenCalled();
  });

  it("surfaces Realtime errors with a localized fallback", () => {
    const ctx = makeCtx({ status: "thinking" });
    dispatchAtlasRealtimeEvent(
      { type: "error", error: { message: "rate limited" } },
      ctx,
    );
    expect(ctx.setError).toHaveBeenLastCalledWith("rate limited");
    dispatchAtlasRealtimeEvent({ type: "invalid_request_error" }, ctx);
    expect(ctx.setError).toHaveBeenLastCalledWith("Realtime connection failed");
    expect(ctx.setStatus).toHaveBeenLastCalledWith("connected");
  });

  it("ignores unrelated events", () => {
    const ctx = makeCtx();
    dispatchAtlasRealtimeEvent({ type: "rate_limits.updated" }, ctx);
    Object.values(ctx)
      .filter((value) => vi.isMockFunction(value))
      .forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });
});
