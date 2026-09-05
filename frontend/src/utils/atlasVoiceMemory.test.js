import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendVoiceMemory,
  loadVoiceMemory,
  saveVoiceMemory,
  MAX_MEMORY_CHARS,
  MAX_MEMORY_LINES,
} from "./atlasVoiceMemory";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
describe("voice session memory", () => {
  it("keeps only bounded recent complete lines and normalizes speech whitespace", () => {
    let memory = "";
    for (let i = 0; i < 30; i++)
      memory = appendVoiceMemory(
        memory,
        "user",
        `line ${i} ${"x".repeat(240)}`,
      );
    expect(memory.length).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
    expect(memory.split("\n").length).toBeLessThanOrEqual(MAX_MEMORY_LINES);
    expect(memory.startsWith("user: ")).toBe(true);
    expect(memory).toContain("line 29");
    expect(memory).not.toContain("line 0 ");
    expect(appendVoiceMemory("", "user", " hello\n world ")).toBe(
      "user: hello world",
    );
  });
  it("uses session storage and tolerates browser storage denial", () => {
    saveVoiceMemory("hello");
    expect(loadVoiceMemory()).toBe("hello");
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadVoiceMemory()).toBe("");
    expect(() => saveVoiceMemory("hello")).not.toThrow();
  });
});
