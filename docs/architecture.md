# Architecture

This document describes the current runtime architecture of Street View Explorer.

Maintenance boundaries: the OpenRouter client separates HTTP/stream transport (`transport.go`), citations, description stream validation, letter generation, interest-region generation and vision guessing into dedicated files in the same Go package. The frontend keeps single-player state in `geoGameState.js`, result UI in `GeoGameResults.jsx`, the duel hub in `GeoBattleHubPage.jsx`, duel results in `GeoBattleResults.jsx`, and snapshot ordering in `geoBattleSnapshot.js`. Atlas Voice retains session orchestration in the panel and delegates audio conversion, navigation, session memory and tool declarations to `atlasVoiceAudio`, `atlasVoiceNavigation`, `atlasVoiceMemory` and `atlasVoiceTools`.

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
  +-- OpenAI Realtime: Atlas Voice live speech sessions
  +-- Volcengine (Doubao) TTS: Atlas Voice speech output in production
```

The frontend uses a persistent anonymous `X-Session-ID`. The backend validates that header and creates one when missing. Preference state and online duel membership depend on that session identity. Visit writes keep the session for bookkeeping. The Atlas footprint map reads the shared site-wide history filtered to `source=random`, so shared links, manual lookups, and map picks do not masquerade as Atlas travel.

## Frontend

The frontend is React 18 with Vite. `frontend/vite.config.js` sets:

- dev server port `3100` by default;
- `/api` proxy to `VITE_API_PROXY_TARGET` from the shell environment (default `http://localhost:8080`);
- production output directory `build`;
- manual chunks for vendor, i18n, and Zustand;
- Vite env prefix `VITE_`.

Routes:

- `/` uses `HomePage` for random Street View exploration.
- On the first home visit in a tab (no `lat`/`lng` in the URL), `HomePage` renders `CoverOverlay` on top: a random full-bleed satellite image from `data/coverPlaces.js` (Sentinel-2 cloudless 2016 © EOX, CC BY 4.0) with the title and a "Set off with Atlas" button. It never advances on its own; the button, Space or Enter fades it out to Street View and Escape skips it. The first stop loads underneath with Street View auto-rotation paused; once its description finishes the next stop is prefetched as usual, so the first explore after the cover is already prepared. The chosen image starts downloading as soon as the cover is chosen. Images live in `public/cover/` and are rebuilt by `scripts/build_cover_images.py`.
- `/footprints` opened from the home page is a background-location overlay: `HomePage` stays mounted (street view paused) and closing returns to it. A direct visit renders only `FootprintPage`, without loading the home page, a random location or a description.
- `/agent` uses `AgentPage` for Odyssey journey setup.
- `/agent/letter/:id` uses `LetterPage` for public letters.
- `/guess` uses `GeoGamePage` for solo satellite guessing.
- `/guess/online` and `/guess/online/:roomId` use `GeoBattlePage` for online duel lobby and room play.
- `/geo`, `/geo/online`, and `/geo/online/:roomId` are legacy redirects to the matching `/guess` routes.

`AgentPage`, `LetterPage`, `GeoGamePage`, and `GeoBattlePage` are lazy loaded from `App.tsx`.

Home exploration prefetches the next stop. Starting with the first stop (including one loaded under the cover), once the current description has finished while the page is visible and the footprint overlay is closed, the store requests `/locations/random?prefetch=1` and streams that place's description (view fixed at heading 0) into a module-level buffer outside the rendered state. The next random explore (button, Space or Atlas Voice random navigation) applies the prefetched place immediately, resets the heading to 0 so the view matches the described frame, takes over the buffered or still-streaming description, and calls `POST /locations/:panoId/visit` to write the deferred footprint. The prefetch is discarded on language or exploration-mode change, failure or after 15 minutes; map picks, place search and URL lookups neither use nor discard it. The backend accepts that footprint only for panoramas this session prefetched, once, within 15 minutes, so the shared footprint map cannot be written arbitrarily. At most one prefetched description per visit goes unused, including visitors who leave after the first stop.

Game feedback shared by solo and online geo modes lives in `frontend/src/hooks/useGameFeedback.js` and `frontend/src/components/GameFeedback.jsx`. It uses Web Audio for short local tones, stores sound toggles in `localStorage` (`geoGameSound` and `geoBattleSound`), and renders accessible `aria-live` feedback bubbles with the same player/opponent/target color language used by map pins.

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
- SQLite-backed per-IP rate limiting when enabled, with per-route limits and global hourly budgets for paid descriptions (exact numbers live in [the runbook](runbook.md#rate-limits)); cost-sensitive paths fail closed if the limiter is unavailable.

Random Earth exploration uses one strategy lane per request: 60% broad coverage (sub-linear population weighting), 30% country-fair, and 10% small-country/frontier. Twelve coordinates from that lane are sampled without repeating a country inside the batch, then resolved concurrently. Each Street View metadata lookup is capped at 25km, and the reverse-geocoded ISO country must match the sampled target country. The first session-novel result wins; exact panorama matches and locations within 50km of the latest 100 random visits receive progressively stronger soft penalties, with a short grace window before a repeated-area fallback is accepted. Repeats remain allowed when no timely novel result is available. A previously verified global random panorama can cap unconstrained random-Earth latency at 1.5 seconds, but country-constrained and interest-constrained requests never use an out-of-scope reservoir fallback. Random visit rows retain the origin coordinate, final coordinate, snap distance, strategy, country codes, radius, and winning candidate number for distribution audits.

Atlas descriptions fetch reverse-geocoded location metadata and the current Street View frame in parallel, then combine that visual context with one focused OpenRouter web search. Visible observations are grounded only in the frame. Descriptions, interest-region generation, and Geo Guess share one image-capable model configured by `OPENROUTER_MODEL` (default `deepseek/deepseek-v4.1-flash`). A failed frame fetch stops the description instead of silently producing a false visual account. Atlas Voice also uses `GET /api/v1/locations/:panoId/streetview-frame` and inserts the latest frame into the Realtime conversation as a silent `input_image` item. `MapsService` keeps bounded TTL caches for location metadata and panorama/view frames. Automatic rotation does not continuously fetch voice frames: the latest view is refreshed when the user speaks or a scene-changing tool completes, with same-scene in-flight requests deduplicated. A failed scene change deletes the previous image context so Atlas cannot describe a stale location.

Text descriptions accept `stream=1` and return `status`, `delta`, `done`, or `error` SSE events. OpenRouter uses the `openrouter:web_search` server tool instead of the deprecated web plugin. Atlas is instructed to make one focused research call with a bounded result/context budget, the server-tool loop is capped at one call, reasoning is disabled for this cost-sensitive path, and the backend reports `research_status=verified` when OpenRouter usage confirms at least one web-search request, or `unverified` otherwise; missing evidence is shown in the UI. Description requests default to Exa fast search with automatic provider routing. `OPENROUTER_DESCRIPTION_PROVIDER_SORT` can select a latency/throughput/price sort, and `OPENROUTER_DESCRIPTION_SEARCH=auto` restores automatic search-engine selection. The bounded experiment and its limitations are recorded in [the latency report](history/atlas-latency-2026-09-05.md). The UI language is repeated as a system-level output contract; the first streamed paragraph is gated to reduce research narration and wrong-language output; the full result is validated again and rejected on a final language mismatch. Interest-region generation uses a separate JSON-only system prompt. The final `done` event replaces streamed draft text with the sanitized body and citation list.

The standard Atlas letter keeps its bounded three-paragraph structure, but its voice contract requires one grounded first-person reaction, one light aside to the reader, varied sentence length, and no report-style transitions. The bracketed arrival thought must be specific to the verified place instead of a reusable stage direction. While the first description is pending, the card header carries the single visible status (`Atlas 正翻着地图…` / `Atlas is tracing the map…`) and the body uses an unlabeled visual progress trail, avoiding duplicate Atlas status copy while retaining an accessible live status.

Odyssey traveler IDs are bearer-equivalent credentials and are sent through the `Authorization` header, never embedded in saved letters or normal frontend URLs. Published letters expose only stable `stop_N` image references. Public Street View image requests are accepted only when the requested panorama belongs to that journey, and Nginx cache keys keep authorization scopes separate.

Atlas Voice uses `frontend/src/components/AtlasVoicePanel.jsx` on the home route. The default transport is a same-origin backend WebSocket proxy at `/api/v1/realtime/ws`, with a WebRTC path available through `VITE_REALTIME_TRANSPORT`. The Realtime model defaults to `gpt-realtime-2.1-mini` (`OPENAI_REALTIME_MODEL`). Atlas defaults to the `cedar` Realtime voice, and can be overridden with `OPENAI_REALTIME_VOICE` for backend-created sessions or `VITE_REALTIME_VOICE` for browser session updates. Turn detection defaults to `semantic_vad` with `high` eagerness for more responsive spoken turns; `server_vad` and its threshold/padding/silence values can be enabled through the Realtime VAD environment variables when a stricter latency tradeoff is desired. Production sets `ATLAS_VOICE_PROVIDER=doubao` (code default `openai`), which keeps OpenAI Realtime responsible for microphone input, text generation, session memory, and tool calls, but changes the session output modality to text and streams the completed Atlas reply through `/api/v1/realtime/doubao-tts`, which proxies Volcengine BigTTS V3 HTTP Chunked output as PCM deltas for the browser queue. The voice tool set is intentionally small: one `navigate` tool with explicit random/theme/place/coordinates/nearby modes, camera direction, and reading the current place context. Only one navigation attempt is allowed per user turn, so a failed concrete-place lookup cannot cascade into theme or random retries. Concrete place jumps call `GET /api/v1/locations/search`, which resolves a landmark/address/business query through Google Places/Geocoding before loading nearby Street View. The backend Realtime WebSocket checks browser origins before proxying to OpenAI: same-origin and local dev hosts are allowed, production additions should be configured with `OPENAI_REALTIME_ALLOWED_ORIGINS`.

Realtime route surface:

- `GET /api/v1/realtime/voice-config` returns the active voice provider plus Doubao TTS readiness and stream shape.
- `GET /api/v1/realtime/client-secret` creates short-lived OpenAI Realtime sessions for the WebRTC path. Disabled (404) unless `REALTIME_WEBRTC_ENABLED=true`, because direct sessions bypass the WebSocket relay limits and event filter.
- `POST /api/v1/realtime/calls` proxies WebRTC SDP offers to OpenAI Realtime (same switch).
- `GET /api/v1/realtime/ws` is the default WebSocket relay. Vite enables `ws: true`, and production Nginx has a dedicated upgrade location with long read/write timeouts.
- `POST /api/v1/realtime/doubao-tts` accepts final Atlas text and returns newline-delimited PCM chunks when Doubao output is enabled.

Outbound network path:

- OpenAI Realtime HTTP/WebSocket calls use `AI_PROXY_URL`, then `PROXY_URL`, then standard environment proxy variables.
- Doubao TTS calls use `DOUBAO_TTS_PROXY_URL` first, then the same Realtime proxy fallback.
- `make dev` and `make dev-start` set the local proxy variables for backend and frontend processes; production should use explicit environment variables in the deployment target.

## Persistent Data

SQLite schema is created in `backend/internal/repositories/sqliterepo.go`.

Tables:

- `locations` - cached or generated Street View location records.
- `exploration_preferences` - custom user interests keyed by session.
- `rate_limits` - backend rate-limit counters.
- `visit_history` - visit records with session bookkeeping plus random-selection diagnostics; the footprint map reads the shared global history filtered to random exploration.
- `agent_journeys` - Odyssey journeys keyed by token.
- `agent_journey_stops` - Odyssey stop records and journal content.

The online duel state is not in SQLite. Rooms, room codes, session-to-room mapping, and matchmaking queue live in process memory in `GeoBattleService`.

## Solo Geo Game

The solo game page `frontend/src/pages/GeoGamePage.jsx` owns the reducer and action handlers and composes `frontend/src/hooks/useGeoGame*.js` (round targets and preloading, satellite size and zoom handoff, guess map, Atlas guess, phase feedback) plus `GeoGameTopBar`, `GeoGameSatellitePanel` and `GeoGameGuessPanel`. Pure helpers live in `frontend/src/utils/geoGameUtils.js`, `geoGameSatellite.js`, `geoGameMapPins.js` and `geoGameTargets.js`.

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
- Both the satellite image proxy and AI guess endpoint accept zoom levels 2-14. Static images use Google Static Maps `scale=2`, `maptype=satellite` and `format=jpg` (3-6x smaller than PNG); the AI guess path re-encodes the annotated image as PNG so the red reticle is not blurred by JPEG chroma subsampling; width and height default to `640x480`, but the frontend sends panel-aware dimensions clamped to 120-640 pixels per side.
- Optional AI guessing calls `POST /api/v1/geo/ai-guess`. The frontend sends the current locked zoom and UI language; the backend fetches exactly that one satellite image and the AI prompt asks for the center point of the image only.
- The satellite panel keeps a center pin visible. Zoom-out fetches the next static image before handing over to the same short reveal animation used by online duel.
- Scoring uses exponential decay by zoom-outs and distance:

```text
round(5000 * exp(-zoomSteps * 0.12) * exp(-effectiveDistanceKm / 1500))
```

`effectiveDistanceKm` subtracts a zoom-aware tolerance before distance decay: `max(0, distanceKm - min(100, 1 * 1.45^zoomSteps))`. This keeps close zooms precise, while allowing broader "roughly there" guesses after many zoom-outs.

## Online Duel

The online duel is implemented in:

- `frontend/src/pages/GeoBattlePage.jsx`, which composes `frontend/src/hooks/useGeoBattle*.js` (room sync and polling, guess map, satellite image handoff, actions, transition feedback), `GeoBattleRoomHeader`, `GeoBattleSatellitePanel`, `GeoBattleMapPanel`, and helpers in `frontend/src/utils/geoBattle*.js`;
- `frontend/src/services/api.js`;
- `backend/internal/api/geo_online_handlers.go`;
- `backend/internal/services/geo_battle_*.go`: `geo_battle_service.go` (types, constructor, cleanup loop), `geo_battle_rooms.go` (private room API), `geo_battle_matchmaking.go`, `geo_battle_phases.go` (round generation and phase transitions), `geo_battle_snapshot.go`, `geo_battle_lookup.go`, `geo_battle_codes.go`, `geo_battle_scoring.go`;
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
- 100 seconds per playing round.
- 5 seconds countdown.
- 8 seconds reveal.
- Queue TTL 10 minutes.
- Finished room TTL 45 minutes.
- Lobby TTL 2 hours.
- Online threshold 25 seconds since last seen.

Snapshot behavior:

- The frontend polls room snapshots every 1.5 seconds while playing and every 2.5 seconds otherwise.
- `server_time` is included so the browser can correct countdown drift.
- A player can see the opponent guess and current-round score only during `reveal` or `finished`. If both players lock before the deadline, the service records the guesses but keeps the room in `playing` until the timer advances.
- The target location is hidden until `reveal` or `finished`.
- `GET /image` returns the current target at the player's current zoom, with `no-store`; it returns image-not-ready during `lobby`, `preparing`, and `countdown`.
- During `reveal` and `finished`, image zoom is capped at 5.
- Each player has independent zoom state. A zoom-out before locking increments only that player's `zoom_steps`.
- Guess scoring matches the solo formula and uses the same zoom-aware distance tolerance. Skips and timeout-created guesses score 0.

Frontend rendering notes:

- The online satellite panel uses the same center-pin and zoom reveal pattern as the solo game. While a new image is loading, the previous image remains visible and map interactions are disabled to avoid flicker or stale clicks.
- Result pins and labels use one stable language: green target, red current player, blue opponent, and purple Atlas only in solo AI mode.
- Reveal panels show the scoring factors explicitly: base score, zoom penalty, tolerance, distance penalty, time remaining or no-time-penalty status, and final score.

Leaving behavior:

- Leaving in `lobby` or `finished` removes the player from the room.
- Leaving during an active match marks the player as left and finishes the room.
- If the host leaves a lobby with another player still present, host ownership moves to the remaining player.

## Deployment

`docker-compose.yml` builds:

- `backend` from `backend/docker/Dockerfile`, which also ships `backend/data/maps` so an empty data volume is seeded with the Natural Earth files;
- `nginx` from `nginx/Dockerfile`, which builds the frontend first and copies `frontend/build`.

Nginx:

- serves the SPA with `try_files ... /index.html`;
- proxies `/api/` to the backend;
- caches `/api/v1/agent/streetview` images by pano and camera parameters;
- exposes `/nginx_status` for the container health check.

The Compose service binds Nginx to `127.0.0.1:3000`.

### Reliability boundaries

SQLite PRAGMAs are applied using the modernc driver syntax on every connection. Rate-limit commit errors fail closed and explicitly roll back the leased connection before it returns to the pool. Internal random-selection history reads omit all-history count queries. Footprints paginate distinct panoramas and render zoom-based clusters.

Forwarding headers are trusted only for configured `TRUSTED_PROXY_CIDRS`. Realtime WebSockets enforce per-IP/global connection budgets, message/read/write limits and maximum duration. The browser keeps cancellation and timeouts attached until response bodies finish, including streamed Doubao TTS. In custom-interest mode, preference synchronization finishes before initial exploration; in random mode with no stored interest the first random location is requested immediately (the backend has no preference to clear). Failed changes preserve the prior mode. Duel preparation is cancellable and deadline validation happens inside mutation locks.
