// @ts-check
// Keep timeout and cancellation attached until the response body is consumed.
/**
 * @param {RequestInfo | URL} url
 * @param {RequestInit} options
 * @param {number} timeout
 */
export async function fetchWithTimeout(url, options = {}, timeout = 25000) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abort = () => controller.abort();
  if (externalSignal?.aborted) abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  const timer = timeout > 0 ? setTimeout(abort, timeout) : null;
  const cleanup = () => {
    if (timer !== null) clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  };

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!response.body) {
      cleanup();
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(stream) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            cleanup();
            stream.close();
          } else {
            stream.enqueue(value);
          }
        } catch (error) {
          cleanup();
          stream.error(error);
        }
      },
      async cancel(reason) {
        cleanup();
        controller.abort();
        await reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}
