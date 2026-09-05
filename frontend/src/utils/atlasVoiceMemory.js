// @ts-check
import { truncateAtlasText } from "./atlasPersona";

const VOICE_MEMORY_KEY = "atlasVoiceMemory";

const MAX_MEMORY_LINES = 16;

const MAX_MEMORY_CHARS = 1600;

function loadVoiceMemory() {
  try {
    return window.sessionStorage?.getItem(VOICE_MEMORY_KEY) || "";
  } catch (err) {
    return "";
  }
}

/** @param {string} memory */
function saveVoiceMemory(memory) {
  try {
    window.sessionStorage?.setItem(VOICE_MEMORY_KEY, memory);
  } catch (err) {
    // Session memory is helpful but nonessential.
  }
}

/** @param {string} memory @param {string} speaker @param {string} text */
function appendVoiceMemory(memory, speaker, text) {
  const cleanText = truncateAtlasText(
    String(text || "").replace(/\s+/g, " "),
    260,
  );
  if (!cleanText) return memory || "";

  const nextLines = [
    ...(memory || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    `${speaker}: ${cleanText}`,
  ].slice(-MAX_MEMORY_LINES);

  let nextMemory = nextLines.join("\n");
  if (nextMemory.length > MAX_MEMORY_CHARS) {
    nextMemory = nextMemory.slice(nextMemory.length - MAX_MEMORY_CHARS);
    nextMemory = nextMemory.replace(/^[^\n]*\n?/, "");
  }
  return nextMemory;
}

export {
  VOICE_MEMORY_KEY,
  MAX_MEMORY_LINES,
  MAX_MEMORY_CHARS,
  loadVoiceMemory,
  saveVoiceMemory,
  appendVoiceMemory,
};
