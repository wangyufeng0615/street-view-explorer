/**
 * Turns a failed `/realtime/doubao-tts` response body into a user-facing
 * message. Missing-credential failures always map to the localized hint.
 *
 * @param {string} body
 * @param {{ ttsError: string, ttsMissingCredentials: string }} copy
 */
export function doubaoErrorMessage(body, copy) {
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
  return message || copy.ttsError;
}

/**
 * Reads the Doubao PCM NDJSON stream and forwards each `audio_delta` event.
 * Lines are ignored once `isCurrent()` turns false (speech was interrupted);
 * an upstream `error` line aborts the stream with an Error.
 *
 * @param {Response} response
 * @param {{
 *   signal: AbortSignal,
 *   isCurrent: () => boolean,
 *   onAudioDelta: (event: { delta: string, sample_rate?: number }) => void,
 *   copy: { ttsError: string, ttsMissingCredentials: string },
 * }} options
 */
export async function playDoubaoSpeechResponse(
  response,
  { signal, isCurrent, onAudioDelta, copy },
) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(doubaoErrorMessage(body, copy));
  }
  if (!response.body) {
    throw new Error(copy.ttsError);
  }

  const reader = response.body.getReader();
  const cancelReader = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancelReader, {
    once: true,
  });
  if (signal.aborted) cancelReader();
  try {
    const decoder = new TextDecoder();
    let buffer = "";

    const handleLine = (line) => {
      if (!line.trim() || !isCurrent()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch (err) {
        return;
      }

      if (event.type === "audio_delta" && event.delta) {
        onAudioDelta(event);
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
    signal.removeEventListener("abort", cancelReader);
    await reader.cancel().catch(() => {});
  }
}
