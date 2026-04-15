import { describe, it, expect } from 'vitest';
import {
  haversineDistance, calculateScore, formatDistance,
  TOTAL_ROUNDS, START_ZOOM, MIN_ZOOM,
} from './geoGameUtils';

describe('haversineDistance', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0);
  });
  it('calculates NYC to London (~5570 km)', () => {
    const d = haversineDistance(40.7128, -74.006, 51.5074, -0.1278);
    expect(d).toBeGreaterThan(5500);
    expect(d).toBeLessThan(5700);
  });
  it('handles antipodal points', () => {
    const d = haversineDistance(0, 0, 0, 180);
    expect(d).toBeGreaterThan(20000);
  });
});

describe('calculateScore', () => {
  it('returns 5000 for 0 steps and 0 distance', () => {
    expect(calculateScore(0, 0)).toBe(5000);
  });

  it('decays with distance', () => {
    expect(calculateScore(0, 100)).toBeGreaterThan(calculateScore(0, 1000));
    expect(calculateScore(0, 1000)).toBeGreaterThan(calculateScore(0, 5000));
  });

  it('decays with zoom steps', () => {
    expect(calculateScore(0, 100)).toBeGreaterThan(calculateScore(5, 100));
    expect(calculateScore(5, 100)).toBeGreaterThan(calculateScore(10, 100));
  });

  it('never goes negative even with many steps', () => {
    expect(calculateScore(20, 10000)).toBeGreaterThanOrEqual(0);
    expect(calculateScore(50, 20000)).toBeGreaterThanOrEqual(0);
  });

  it('exponential decay: ~55% at 5 steps, ~30% at 10 steps', () => {
    const at5 = calculateScore(5, 0);
    const at10 = calculateScore(10, 0);
    expect(at5 / 5000).toBeCloseTo(Math.exp(-5 * 0.12), 1);
    expect(at10 / 5000).toBeCloseTo(Math.exp(-10 * 0.12), 1);
  });

  it('combined: 3 steps, 200km', () => {
    const expected = Math.round(5000 * Math.exp(-3 * 0.12) * Math.exp(-200 / 1500));
    expect(calculateScore(3, 200)).toBe(expected);
  });
});

describe('formatDistance', () => {
  it('formats sub-km as meters', () => expect(formatDistance(0.5)).toBe('500 m'));
  it('formats small km with decimal', () => expect(formatDistance(5.67)).toBe('5.7 km'));
  it('formats large km as integer', () => expect(formatDistance(1234)).toMatch(/1,?234 km/));
  it('handles zero', () => expect(formatDistance(0)).toBe('0 m'));
});

describe('constants', () => {
  it('has correct values', () => {
    expect(TOTAL_ROUNDS).toBe(5);
    expect(START_ZOOM).toBe(14);
    expect(MIN_ZOOM).toBe(2);
  });
});
