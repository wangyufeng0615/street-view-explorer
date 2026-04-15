import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const neverSettles = () => new Promise(() => {});

vi.mock('../utils/googleMaps', () => ({
  loadGoogleMapsScript: vi.fn(() => neverSettles()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en' } }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('../services/api', () => ({
  getRandomLocation: vi.fn(() => neverSettles()),
}));

global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ success: false }),
});

import GeoGamePage from './GeoGamePage';

describe('GeoGamePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders welcome modal', () => {
    render(<GeoGamePage />);
    expect(screen.getByText('geo.title')).toBeInTheDocument();
    expect(screen.getByText('geo.start')).toBeInTheDocument();
  });

  it('shows rules', () => {
    render(<GeoGamePage />);
    expect(screen.getByText('geo.welcome_rule_1')).toBeInTheDocument();
    expect(screen.getByText('geo.welcome_rule_2')).toBeInTheDocument();
    expect(screen.getByText('geo.welcome_rule_3')).toBeInTheDocument();
  });

  it('toggles AI', () => {
    render(<GeoGamePage />);
    const cb = screen.getByRole('checkbox');
    expect(cb.checked).toBe(false);
    fireEvent.click(screen.getByText('geo.enable_ai'));
    expect(cb.checked).toBe(true);
  });

  it('starts game', () => {
    render(<GeoGamePage />);
    fireEvent.click(screen.getByText('geo.start'));
    expect(screen.queryByText('geo.start')).not.toBeInTheDocument();
  });
});
