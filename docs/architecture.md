# Architecture

This document describes the current runtime architecture of Street View Explorer.

## System Shape

```text
Browser (React + Vite)
  |
  | same-origin /api/v1
  v
Nginx in production, Vite proxy in development
  |
  v
Go backend (Gin)
  |
  +-- SQLite: locations, preferences, visit history, rate limits, Odyssey journeys
  +-- In-memory maps: online duel rooms and matchmaking queue
  +-- Google Maps APIs: Street View, Static Maps, geocoding, places
  +-- OpenRouter: AI descriptions and satellite-image guesses
```

The frontend uses a persistent anonymous `X-Session-ID`. The backend validates that header and creates one when missing. Preference state, visit history, and online duel membership all depend on that session identity.

## Frontend

The frontend is React 18 with Vite. `frontend/vite.config.js` sets:

- dev server port `3000`;
- `/api` proxy to `http://localhost:8080`;
- production output directory `build`;
- manual chunks for vendor, i18n, and Zustand;
- Vite env prefix `VITE_`.

Routes:

- `/` uses `HomePage` for random Street View exploration.
- `/agent` uses `AgentPage` for Odyssey journey setup.
- `/agent/letter/:id` uses `LetterPage` for public letters.
- `/geo` uses `GeoGamePage` for solo satellite guessing.
- `/geo/online` and `/geo/online/:roomId` use `GeoBattlePage` for online duel lobby and room play.

`AgentPage`, `LetterPage`, `GeoGamePage`, and `GeoBattlePage` are lazy loaded from `App.tsx`.

## Backend

The backend entrypoint is `backend/cmd/server/main.go`.

Startup sequence:

1. Load `.env` through `config.New()`.
2. Initialize Sentry if enabled.
3. Apply optional shared or service-specific outbound proxy settings.
4. Initialize geographic polygon data through `utils.InitializeGeoData()`.
5. Open SQLite and run migrations.
6. Create Google Maps, OpenRouter, location, AI, and geo battle services.
7. Register Gin middleware and routes.

Key middleware:

- request logging with special successful-agent request logging;
- input validation for request size, `panoId`, and page query bounds;
- session management through `X-Session-ID`;
- SQLite-backed rate limiting when enabled.

## Persistent Data

SQLite schema is created in `backend/internal/repositories/sqliterepo.go`.

Tables:

- `locations` - cached or generated Street View location records.
- `exploration_preferences` - custom user interests keyed by session.
- `rate_limits` - backend rate-limit counters.
- `visit_history` - per-session visit history.
- `agent_journeys` - Odyssey journeys keyed by token.
- `agent_journey_stops` - Odyssey stop records and journal content.

The online duel state is not in SQLite. Rooms, room codes, session-to-room mapping, and matchmaking queue live in process memory in `GeoBattleService`.

## Solo Geo Game

The solo game is implemented mostly in `frontend/src/pages/GeoGamePage.jsx` and `frontend/src/utils/geoGameUtils.js`.

Game flow:

```text
WELCOME -> LOADING -> PLAYING -> ROUND_RESULT -> LOADING ... -> GAME_OVER
```

Round selection:

- `TOTAL_ROUNDS` is 5.
- `generateRoundPlan()` chooses 2 or 3 curated database entries, clamped to total rounds.
- Remaining rounds call `GET /api/v1/locations/random?source=geo_game`.
- Curated entries are jittered by `jitterCoord()` before display.

Image and scoring:

- Satellite images are fetched through `GET /api/v1/geo/satellite` to keep the Google Static Maps key on the backend path.
- Optional AI guessing calls `POST /api/v1/geo/ai-guess`.
- Scoring uses exponential decay by zoom-outs and distance:

```text
round(5000 * exp(-zoomSteps * 0.12) * exp(-distanceKm / 1500))
```

## Online Duel

The online duel is implemented in:

- `frontend/src/pages/GeoBattlePage.jsx`;
- `frontend/src/services/api.js`;
- `backend/internal/api/geo_online_handlers.go`;
- `backend/internal/services/geo_battle_service.go`;
- `backend/internal/models/geo_battle.go`.

Modes:

- `private` - one player creates a room, shares a 6-character code, and the second player joins.
- `matchmaking` - the queue pairs the earliest available waiting player with the next compatible player.

State machine:

```text
lobby
  -> preparing
  -> countdown
  -> playing
  -> reveal
  -> countdown ... repeat
  -> finished
```

Important constants:

- 5 rounds per match.
- Start zoom 14, minimum zoom 2.
- 90 seconds per playing round.
- 5 seconds countdown.
- 8 seconds reveal.
- Queue TTL 10 minutes.
- Finished room TTL 45 minutes.
- Lobby TTL 2 hours.
- Online threshold 25 seconds since last seen.

Snapshot behavior:

- The frontend polls room snapshots every 1.5 seconds while playing and every 2.5 seconds otherwise.
- `server_time` is included so the browser can correct countdown drift.
- A player can see the opponent guess only during `reveal` or `finished`.
- The target location is hidden until `reveal` or `finished`.
- `GET /image` returns the current target at the player's current zoom, with `no-store`.
- During `reveal` and `finished`, image zoom is capped at 5.

Leaving behavior:

- Leaving in `lobby` or `finished` removes the player from the room.
- Leaving during an active match marks the player as left and finishes the room.
- If the host leaves a lobby with another player still present, host ownership moves to the remaining player.

## Deployment

`docker-compose.yml` builds:

- `backend` from `backend/docker/Dockerfile`;
- `nginx` from `nginx/Dockerfile`, which builds the frontend first and copies `frontend/build`.

Nginx:

- serves the SPA with `try_files ... /index.html`;
- proxies `/api/` to the backend;
- caches `/api/v1/agent/streetview` images by pano and camera parameters;
- exposes `/nginx_status` for the container health check.

The Compose service binds Nginx to `127.0.0.1:3000`.
