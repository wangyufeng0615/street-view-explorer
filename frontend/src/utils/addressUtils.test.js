import { describe, it, expect } from 'vitest';
import { formatAddress } from './addressUtils';

describe('localized country suffix', () => {
  it('changes country language without guessing or altering the locality', () => {
    const loc = { formatted_address: 'Unnamed Road, Paia, 萨摩亚', country: '萨摩亚', country_code: 'WS' };
    expect(formatAddress(loc, 'en')).toBe('Unnamed Road, Paia, Samoa');
    expect(formatAddress(loc, 'zh')).toBe(loc.formatted_address);
    expect(formatAddress({ ...loc, country_code: undefined }, 'en')).toBe(loc.formatted_address);
  });
});
