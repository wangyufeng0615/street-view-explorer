import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from './fetchWithTimeout';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function pendingBody() {
  let signal;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({
      start(stream) {
        signal.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')));
      },
    }));
  });
  return () => signal;
}

describe('response body lifecycle', () => {
  it('cancels a TTS stream after headers have arrived', async () => {
    const signal = pendingBody();
    const controller = new AbortController();
    const response = await fetchWithTimeout('/tts', { signal: controller.signal });
    const read = response.text();
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    expect(signal().aborted).toBe(true);
  });

  it('times out a stalled body, not only the headers', async () => {
    vi.useFakeTimers();
    pendingBody();
    const response = await fetchWithTimeout('/json', {}, 100);
    const assertion = expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases timers after completion and preserves HTTP status', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"busy"}', { status: 429 }));
    const response = await fetchWithTimeout('/json');
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'busy' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
