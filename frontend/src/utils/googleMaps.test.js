import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const language = vi.hoisted(() => ({ language: 'zh' }));
vi.mock('../i18n', () => ({ default: language }));

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); delete window.google; language.language = 'zh'; });
afterEach(() => { vi.useRealTimers(); document.querySelectorAll('script[data-google-maps]').forEach(s=>s.remove()); delete window.google; });

it('shares an in-flight SDK across language changes and never reloads a registered API', async () => {
  const { loadGoogleMapsScript } = await import('./googleMaps');
  const first = loadGoogleMapsScript();
  language.language = 'en';
  const second = loadGoogleMapsScript();
  expect(first).toBe(second);
  const scripts = document.querySelectorAll('script[data-google-maps]');
  expect(scripts).toHaveLength(1);
  window.google = { maps: { Map: function Map() {} } };
  const api = window.google.maps;
  window[new URL(scripts[0].src).searchParams.get('callback')]();
  expect(await first).toBe(api);
  language.language = 'zh';
  expect(await loadGoogleMapsScript()).toBe(api);
  expect(document.querySelectorAll('script[data-google-maps]')).toHaveLength(1);
});
