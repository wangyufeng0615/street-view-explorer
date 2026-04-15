import React, { useReducer, useEffect, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { loadGoogleMapsScript } from '../utils/googleMaps';
import { getRandomLocation } from '../services/api';
import {
  TOTAL_ROUNDS, START_ZOOM, MIN_ZOOM,
  haversineDistance, calculateScore, formatDistance,
  generateRoundPlan, jitterCoord,
} from '../utils/geoGameUtils';
import '../styles/GeoGame.css';

// ─── State ──────────────────────────────────────────────────

const initialState = {
  phase: 'WELCOME',
  round: 0,
  scores: [],
  target: null,      // { lat, lng, address?, country? }
  zoomSteps: 0,
  currentZoom: START_ZOOM,
  guessPin: null,
  guessResult: null,  // { lat, lng, distance, score } or { lat:null, lng:null, distance:null, score:0 } for give-up
  aiEnabled: false,
  aiGuess: null,
  aiLoading: false,
  roundPlan: null,    // Array<{ source: 'database'|'random', entry? }>
};

function reducer(state, action) {
  switch (action.type) {
    case 'TOGGLE_AI':
      return { ...state, aiEnabled: !state.aiEnabled };
    case 'START_GAME': {
      const roundPlan = generateRoundPlan(TOTAL_ROUNDS);
      return { ...initialState, phase: 'LOADING', round: 1, aiEnabled: state.aiEnabled, roundPlan };
    }
    case 'SET_TARGET':
      return { ...state, phase: 'PLAYING', target: action.payload };
    case 'ZOOM_OUT':
      if (state.currentZoom <= MIN_ZOOM) return state;
      return { ...state, zoomSteps: state.zoomSteps + 1, currentZoom: state.currentZoom - 1 };
    case 'PLACE_PIN':
      return { ...state, guessPin: action.payload };
    case 'LOCK_IN': {
      const { lat, lng } = state.guessPin;
      const dist = haversineDistance(lat, lng, state.target.lat, state.target.lng);
      const score = calculateScore(state.zoomSteps, dist);
      return { ...state, phase: 'ROUND_RESULT', guessResult: { lat, lng, distance: dist, score }, guessPin: null };
    }
    case 'GIVE_UP':
      return { ...state, phase: 'ROUND_RESULT', guessResult: { lat: null, lng: null, distance: null, score: 0 }, guessPin: null };
    case 'SET_AI_GUESS':
      return { ...state, aiGuess: action.payload, aiLoading: false };
    case 'SET_AI_LOADING':
      return { ...state, aiLoading: true };
    case 'NEXT_ROUND': {
      const roundResult = {
        playerScore: state.guessResult?.score || 0,
        distance: state.guessResult?.distance ?? null,
        zoomSteps: state.zoomSteps,
        aiScore: state.aiGuess?.score ?? null,
      };
      const newScores = [...state.scores, roundResult];
      const isLast = state.round >= TOTAL_ROUNDS;
      return {
        ...state, scores: newScores,
        phase: isLast ? 'GAME_OVER' : 'LOADING',
        round: isLast ? state.round : state.round + 1,
        target: null, zoomSteps: 0, currentZoom: START_ZOOM,
        guessPin: null, guessResult: null, aiGuess: null, aiLoading: false,
        roundPlan: state.roundPlan, // preserve across rounds
      };
    }
    case 'RESTART':
      return { ...initialState };
    default:
      return state;
  }
}

function satUrl(target, zoom) {
  return `/api/v1/geo/satellite?lat=${target.lat}&lng=${target.lng}&zoom=${zoom}`;
}

// ─── Component ──────────────────────────────────────────────

export default function GeoGamePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initialState);

  const guessMapElRef = useRef(null);
  const guessInstanceRef = useRef(null);
  const mapsAPIRef = useRef(null);
  const pendingMarkerRef = useRef(null);
  const resultMarkersRef = useRef([]);
  const resultLinesRef = useRef([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  // ─── Fetch location: database entry or random API ───
  // i18n.language is read via ref to avoid re-triggering on language change.
  const langRef = useRef(i18n.language);
  langRef.current = i18n.language;

  useEffect(() => {
    if (state.phase !== 'LOADING' || !state.roundPlan) return;
    const plan = state.roundPlan[state.round - 1];

    // Database round — use curated entry, no network call
    if (plan && plan.source === 'database') {
      const e = plan.entry;
      const { lat, lng } = jitterCoord(e.lat, e.lng);
      const isZh = langRef.current?.startsWith('zh');
      const name = isZh ? e.nameZh : e.name;
      const country = isZh ? e.countryZh : e.country;
      dispatch({
        type: 'SET_TARGET',
        payload: { lat, lng, address: `${name}, ${country}`, country },
      });
      return;
    }

    // Random round — call API
    let cancelled = false;
    (async () => {
      const res = await getRandomLocation(null, 'geo_game');
      if (cancelled) return;
      if (res.success && res.data) {
        const d = res.data;
        dispatch({ type: 'SET_TARGET', payload: { lat: d.latitude, lng: d.longitude, address: d.formatted_address, country: d.country } });
      } else {
        const retry = await getRandomLocation(null, 'geo_game');
        if (cancelled) return;
        if (retry.success && retry.data) {
          const d = retry.data;
          dispatch({ type: 'SET_TARGET', payload: { lat: d.latitude, lng: d.longitude, address: d.formatted_address, country: d.country } });
        } else {
          dispatch({ type: 'RESTART' });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [state.phase, state.round, state.roundPlan]);

  // ─── Load Google Maps API (with error handling) ───
  useEffect(() => {
    loadGoogleMapsScript()
      .then((maps) => { mapsAPIRef.current = maps; setMapsReady(true); })
      .catch(() => setMapsError(true));
  }, []);

  // ─── Init guess map ───
  useEffect(() => {
    if (!mapsReady || !guessMapElRef.current || guessInstanceRef.current) return;
    const maps = mapsAPIRef.current;

    guessInstanceRef.current = new maps.Map(guessMapElRef.current, {
      center: { lat: 20, lng: 0 }, zoom: 2, mapTypeId: 'roadmap',
      disableDefaultUI: true, zoomControl: true,
    });

    guessInstanceRef.current.addListener('click', (e) => {
      const s = stateRef.current;
      if (s.phase !== 'PLAYING') return;
      const pos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      dispatch({ type: 'PLACE_PIN', payload: pos });
      if (pendingMarkerRef.current) {
        pendingMarkerRef.current.setPosition(pos);
      } else {
        pendingMarkerRef.current = new maps.Marker({
          position: pos, map: guessInstanceRef.current,
          icon: { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#ef4444', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        });
      }
    });
  }, [mapsReady]);

  // ─── Preload next zoom level ───
  useEffect(() => {
    if (!state.target || state.phase !== 'PLAYING') return;
    const nextZoom = state.currentZoom - 1;
    if (nextZoom < MIN_ZOOM) return;
    const img = new Image();
    img.src = satUrl(state.target, nextZoom);
  }, [state.currentZoom, state.target, state.phase]);

  // ─── Reset image state on zoom change ───
  useEffect(() => { setImgLoaded(false); setImgError(false); }, [state.currentZoom, state.target]);

  // ─── Show result markers (re-runs when AI guess arrives late) ───
  useEffect(() => {
    if (state.phase !== 'ROUND_RESULT' || !mapsAPIRef.current || !state.target) return;
    const maps = mapsAPIRef.current;
    const tp = { lat: state.target.lat, lng: state.target.lng };

    if (pendingMarkerRef.current) { pendingMarkerRef.current.setMap(null); pendingMarkerRef.current = null; }
    resultMarkersRef.current.forEach((m) => m.setMap(null)); resultMarkersRef.current = [];
    resultLinesRef.current.forEach((l) => l.setMap(null)); resultLinesRef.current = [];

    // Target (green)
    resultMarkersRef.current.push(new maps.Marker({
      position: tp, map: guessInstanceRef.current,
      icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#10b981', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }, zIndex: 10,
    }));

    // Player guess (red) — skip if gave up (lat is null)
    if (state.guessResult && state.guessResult.lat != null) {
      const gp = { lat: state.guessResult.lat, lng: state.guessResult.lng };
      resultMarkersRef.current.push(new maps.Marker({
        position: gp, map: guessInstanceRef.current,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#ef4444', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      }));
      resultLinesRef.current.push(new maps.Polyline({
        path: [gp, tp], strokeColor: '#ef4444', strokeWeight: 2, strokeOpacity: 0.7, geodesic: true, map: guessInstanceRef.current,
      }));
    }

    // AI guess (purple)
    if (state.aiGuess) {
      const ap = { lat: state.aiGuess.lat, lng: state.aiGuess.lng };
      resultMarkersRef.current.push(new maps.Marker({
        position: ap, map: guessInstanceRef.current,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#8b5cf6', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      }));
      resultLinesRef.current.push(new maps.Polyline({
        path: [ap, tp], strokeColor: '#8b5cf6', strokeWeight: 1.5, strokeOpacity: 0.6, geodesic: true, map: guessInstanceRef.current,
      }));
    }

    const bounds = new maps.LatLngBounds();
    bounds.extend(tp);
    if (state.guessResult && state.guessResult.lat != null) bounds.extend({ lat: state.guessResult.lat, lng: state.guessResult.lng });
    if (state.aiGuess) bounds.extend({ lat: state.aiGuess.lat, lng: state.aiGuess.lng });
    guessInstanceRef.current.fitBounds(bounds, 40);
  }, [state.phase, state.aiGuess, mapsReady]);

  // ─── AI guess ───
  const aiControllerRef = useRef(null);
  useEffect(() => {
    if (!state.target || !state.aiEnabled) return;
    if (aiControllerRef.current) aiControllerRef.current.abort();
    const controller = new AbortController();
    aiControllerRef.current = controller;

    dispatch({ type: 'SET_AI_LOADING' });
    fetch('/api/v1/geo/ai-guess', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: state.target.lat, lng: state.target.lng, zoom: 12 }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data) {
          const { lat, lng, reasoning } = data.data;
          const dist = haversineDistance(lat, lng, state.target.lat, state.target.lng);
          dispatch({ type: 'SET_AI_GUESS', payload: { lat, lng, distance: dist, score: calculateScore(5, dist), reasoning } });
        } else {
          dispatch({ type: 'SET_AI_GUESS', payload: null });
        }
      })
      .catch(() => dispatch({ type: 'SET_AI_GUESS', payload: null }));

    return () => { controller.abort(); aiControllerRef.current = null; };
  }, [state.target, state.aiEnabled]);

  // ─── Cleanup ───
  function cleanupMarkers() {
    if (pendingMarkerRef.current) { pendingMarkerRef.current.setMap(null); pendingMarkerRef.current = null; }
    resultMarkersRef.current.forEach((m) => m.setMap(null)); resultMarkersRef.current = [];
    resultLinesRef.current.forEach((l) => l.setMap(null)); resultLinesRef.current = [];
    if (guessInstanceRef.current) { guessInstanceRef.current.setCenter({ lat: 20, lng: 0 }); guessInstanceRef.current.setZoom(2); }
  }
  const handleNextRound = useCallback(() => {
    if (stateRef.current.aiEnabled && stateRef.current.aiLoading) return;
    cleanupMarkers();
    dispatch({ type: 'NEXT_ROUND' });
  }, []);
  const handleRestart = useCallback(() => { cleanupMarkers(); dispatch({ type: 'RESTART' }); }, []);

  // In result phase, zoom out to show wider context (zoom 5 = regional view)
  const displayZoom = state.phase === 'ROUND_RESULT' ? Math.min(state.currentZoom, 5) : state.currentZoom;
  const satelliteUrl = state.target ? satUrl(state.target, displayZoom) : null;
  const canZoomOut = state.currentZoom > MIN_ZOOM && state.phase === 'PLAYING';

  return (
    <div className="geo-game">
      {state.phase !== 'WELCOME' && (
        <div className="geo-topbar">
          <div className="geo-topbar-left">
            <button className="geo-topbar-back" onClick={() => navigate('/')}>← {t('geo.back')}</button>
            <span className="geo-topbar-title">{t('geo.title')}</span>
            {state.round > 0 && <span className="geo-topbar-round">{t('geo.round', { n: state.round })} / {TOTAL_ROUNDS}</span>}
          </div>
          {state.phase === 'PLAYING' && (
            <div className="geo-topbar-right">
              <span className="geo-zoom-badge">{t('geo.zoom_steps')}: {state.zoomSteps}</span>
            </div>
          )}
        </div>
      )}

      <div className="geo-main">
        <div className="geo-satellite">
          {satelliteUrl && (
            <img
              key={satelliteUrl}
              src={satelliteUrl}
              className={`geo-satellite-img ${imgLoaded ? 'loaded' : ''}`}
              alt=""
              draggable={false}
              onLoad={() => setImgLoaded(true)}
              onError={() => { setImgError(true); setImgLoaded(true); }}
            />
          )}
          {(state.phase === 'LOADING' || (state.phase === 'PLAYING' && !imgLoaded)) && (
            <div className="geo-loading-overlay">
              <div className="geo-loading-spinner" />
              {state.phase === 'LOADING' ? t('geo.loading') : ''}
            </div>
          )}
          {imgError && state.phase === 'PLAYING' && (
            <div className="geo-loading-overlay">
              <span>{t('geo.image_error')}</span>
            </div>
          )}
        </div>

        <div className="geo-guess-panel">
          <div className="geo-guess-map-area">
            {mapsError ? (
              <div className="geo-map-error">{t('geo.map_error')}</div>
            ) : (
              <div ref={guessMapElRef} className="geo-map-container" />
            )}
          </div>
          {state.phase === 'PLAYING' && (
            <div className="geo-guess-controls">
              <button className="geo-zoom-out-btn" disabled={!canZoomOut} onClick={() => dispatch({ type: 'ZOOM_OUT' })}>
                {t('geo.zoom_out')}
              </button>
              {!state.guessPin && <span className="geo-click-hint">{t('geo.click_map')}</span>}
              <button className="geo-lock-in" disabled={!state.guessPin} onClick={() => dispatch({ type: 'LOCK_IN' })}>
                {t('geo.lock_in')}
              </button>
              <button className="geo-give-up" onClick={() => dispatch({ type: 'GIVE_UP' })}>
                {t('geo.give_up')}
              </button>
            </div>
          )}
          {state.phase === 'ROUND_RESULT' && <RoundResult state={state} t={t} onNext={handleNextRound} />}
        </div>
      </div>

      {state.phase === 'WELCOME' && <WelcomeModal state={state} dispatch={dispatch} t={t} />}
      {state.phase === 'GAME_OVER' && <GameOverModal state={state} t={t} onRestart={handleRestart} onNext={handleNextRound} />}
    </div>
  );
}

// ─── WelcomeModal ───

function WelcomeModal({ state, dispatch, t }) {
  return (
    <div className="geo-modal-overlay">
      <div className="geo-modal">
        <div className="geo-modal-title">{t('geo.title')}</div>
        <div className="geo-modal-subtitle">{t('geo.subtitle')}</div>
        <ul className="geo-modal-rules">
          <li>{t('geo.welcome_rule_1')}</li>
          <li>{t('geo.welcome_rule_2')}</li>
          <li>{t('geo.welcome_rule_3')}</li>
        </ul>
        <label className="geo-ai-toggle">
          <input type="checkbox" className="geo-ai-toggle-checkbox" checked={state.aiEnabled} onChange={() => dispatch({ type: 'TOGGLE_AI' })} />
          <div>
            <div className="geo-ai-toggle-label">{t('geo.enable_ai')}</div>
            <div className="geo-ai-toggle-hint">{t('geo.ai_toggle_hint')}</div>
          </div>
        </label>
        <button className="geo-start-btn" onClick={() => dispatch({ type: 'START_GAME' })}>{t('geo.start')}</button>
      </div>
    </div>
  );
}

// ─── RoundResult ───

function RoundResult({ state, t, onNext }) {
  const gaveUp = state.guessResult && state.guessResult.lat == null;

  return (
    <div className="geo-result-panel">
      <div className="geo-result-title">{t('geo.round', { n: state.round })} — {t('geo.result')}</div>

      {/* Actual location reveal */}
      {state.target && (state.target.address || state.target.country) && (
        <div className="geo-result-location">
          {state.target.address || state.target.country}
        </div>
      )}

      <div className="geo-result-section">
        <div className="geo-result-label">{t('geo.your_guess')}</div>
        {gaveUp ? (
          <div className="geo-result-distance">{t('geo.gave_up')}</div>
        ) : state.guessResult ? (
          <>
            <div className="geo-result-value">+{state.guessResult.score.toLocaleString()}</div>
            <div className="geo-result-distance">{formatDistance(state.guessResult.distance)} · {state.zoomSteps} {t('geo.steps_used')}</div>
          </>
        ) : (
          <div className="geo-result-distance">{t('geo.no_guess')}</div>
        )}
      </div>

      {state.aiEnabled && (
        <>
          <div className="geo-result-divider" />
          <div className="geo-result-ai-section">
            <div className="geo-result-ai-label">Atlas</div>
            {state.aiGuess ? (
              <>
                <div className="geo-result-ai-score">+{state.aiGuess.score.toLocaleString()}</div>
                <div className="geo-result-ai-distance">{formatDistance(state.aiGuess.distance)}</div>
                {state.aiGuess.reasoning && (
                  <div className="geo-result-ai-reasoning">
                    &ldquo;{state.aiGuess.reasoning}&rdquo;
                  </div>
                )}
              </>
            ) : (
              <div className="geo-result-ai-distance">{state.aiLoading ? t('geo.ai_thinking') : t('geo.ai_unavailable')}</div>
            )}
          </div>
        </>
      )}

      <button
        className="geo-result-btn"
        disabled={state.aiEnabled && state.aiLoading}
        onClick={onNext}
      >
        {state.aiEnabled && state.aiLoading
          ? t('geo.ai_thinking')
          : state.round >= TOTAL_ROUNDS ? t('geo.see_results') : t('geo.next_round')}
      </button>
    </div>
  );
}

// ─── GameOverModal ───

function GameOverModal({ state, t, onRestart, onNext }) {
  useEffect(() => { if (state.scores.length < TOTAL_ROUNDS) onNext(); }, []);
  const playerTotal = state.scores.reduce((s, r) => s + r.playerScore, 0);
  const aiTotal = state.aiEnabled ? state.scores.reduce((s, r) => s + (r.aiScore || 0), 0) : null;

  return (
    <div className="geo-modal-overlay">
      <div className="geo-modal">
        <div className="geo-modal-title">{t('geo.game_over')}</div>
        <div className="geo-gameover-rounds">
          {state.scores.map((r, i) => (
            <div key={i} className="geo-gameover-round">
              <span className="geo-gameover-round-label">{t('geo.round', { n: i + 1 })}</span>
              <span className="geo-gameover-round-score">{r.distance !== null ? `+${r.playerScore.toLocaleString()}` : '—'}</span>
            </div>
          ))}
        </div>
        <div className="geo-gameover-total">
          <span className="geo-gameover-total-label">{t('geo.total_score')}</span>
          <span className="geo-gameover-total-score">{playerTotal.toLocaleString()}</span>
        </div>
        {aiTotal !== null && (
          <div className="geo-gameover-ai-total">
            <span className="geo-gameover-ai-label">Atlas</span>
            <span className="geo-gameover-ai-score">{aiTotal.toLocaleString()}</span>
          </div>
        )}
        <button className="geo-start-btn" onClick={onRestart}>{t('geo.play_again')}</button>
      </div>
    </div>
  );
}
