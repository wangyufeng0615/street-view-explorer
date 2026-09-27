import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_CONFIG,
  REALTIME_TRANSCRIPTION_MODEL,
  REALTIME_VOICE,
  buildAtlasVoiceSession,
  extractAssistantText,
  extractToken,
  getLocale,
  normalizeVoiceConfig,
  realtimeWebSocketURL,
} from "./atlasVoiceConfig";
import { TOOL_DEFINITIONS } from "./atlasVoiceTools";

describe("atlas voice config", () => {
  it("maps any zh variant to zh and everything else to en", () => {
    expect(getLocale("zh-CN")).toBe("zh");
    expect(getLocale("zh")).toBe("zh");
    expect(getLocale("en-US")).toBe("en");
    expect(getLocale("ja")).toBe("en");
    expect(getLocale(undefined)).toBe("en");
  });

  it("merges server config over defaults and normalizes the provider", () => {
    expect(
      normalizeVoiceConfig({ provider: "Doubao", doubao_configured: true }, ""),
    ).toEqual({
      ...DEFAULT_VOICE_CONFIG,
      provider: "doubao",
      doubao_configured: true,
    });
    expect(normalizeVoiceConfig(null, "")).toEqual(DEFAULT_VOICE_CONFIG);
  });

  it("lets a build-time provider override win over the server config", () => {
    expect(
      normalizeVoiceConfig({ provider: "openai" }, "doubao").provider,
    ).toBe("doubao");
    expect(normalizeVoiceConfig({ provider: "doubao" }, "bogus").provider).toBe(
      "openai",
    );
  });

  it("extracts spoken or written assistant text from message items only", () => {
    expect(
      extractAssistantText({
        type: "message",
        content: [
          { type: "output_text", text: "Hello" },
          { type: "audio", transcript: "there" },
          { type: "input_text", text: "ignored" },
          { type: "output_text", text: "" },
        ],
      }),
    ).toBe("Hello there");
    expect(extractAssistantText({ type: "function_call" })).toBe("");
    expect(extractAssistantText(null)).toBe("");
  });

  it("reads the client secret from every supported payload shape", () => {
    expect(extractToken({ value: "a" })).toBe("a");
    expect(extractToken({ client_secret: { value: "b" } })).toBe("b");
    expect(extractToken({ data: { value: "c" } })).toBe("c");
    expect(extractToken(undefined)).toBeUndefined();
  });

  it("builds a same-origin websocket URL with the matching scheme", () => {
    expect(
      realtimeWebSocketURL("zh", { protocol: "https:", host: "atlas.example" }),
    ).toBe("wss://atlas.example/api/v1/realtime/ws?lang=zh");
    expect(
      realtimeWebSocketURL("en&x", {
        protocol: "http:",
        host: "127.0.0.1:3100",
      }),
    ).toBe("ws://127.0.0.1:3100/api/v1/realtime/ws?lang=en%26x");
  });
});

describe("buildAtlasVoiceSession", () => {
  const state = { location: null, description: "", heading: 0 };

  it("keeps Realtime text-only for doubao speech", () => {
    const session = buildAtlasVoiceSession({
      locale: "zh",
      state,
      memory: "",
      useDoubaoSpeech: true,
      includeOutput: false,
    });
    expect(session.output_modalities).toEqual(["text"]);
    expect(session.audio.output).toBeUndefined();
    expect(session.tools).toBe(TOOL_DEFINITIONS);
    expect(session.tool_choice).toBe("auto");
    expect(session.audio.input.transcription.model).toBe(
      REALTIME_TRANSCRIPTION_MODEL,
    );
  });

  it("configures the output voice only when requested", () => {
    const withOutput = buildAtlasVoiceSession({
      locale: "en",
      state,
      memory: "User: hi",
      useDoubaoSpeech: false,
      includeOutput: true,
    });
    expect(withOutput.output_modalities).toEqual(["audio"]);
    expect(withOutput.audio.output).toEqual({
      voice: REALTIME_VOICE,
      speed: expect.any(Number),
    });
    expect(withOutput.instructions).toContain("User: hi");

    const withoutOutput = buildAtlasVoiceSession({
      locale: "en",
      state,
      memory: "",
      useDoubaoSpeech: false,
      includeOutput: false,
    });
    expect(withoutOutput.audio.output).toBeUndefined();
  });
});
