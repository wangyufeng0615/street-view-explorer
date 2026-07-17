# Street View Explorer

[![Live Demo](https://img.shields.io/badge/Live-earth.wangyufeng.org-blue)](https://earth.wangyufeng.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go)](https://go.dev/)
[![React Version](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7.1-646CFF?logo=vite)](https://vitejs.dev/)

An interactive map application for exploring random Google Street View locations, generating AI location descriptions, and playing satellite-image geography games.

## Features

- Coverage-aware global exploration with broad/fair/frontier country lanes, bounded Street View snapping, and session-level repeat avoidance.
- Streamed Atlas letters and detailed follow-ups through OpenRouter, grounded in the Street View frame the user is currently facing and verified against server-side web search.
- Visit history, a shared site-wide Atlas random-exploration footprint map, and regional or custom exploration preferences.
- Bilingual UI in English and Chinese.
- Atlas Voice on the home route, with the latest Street View frame as Realtime visual context, interruptible spoken turns, concrete place search, nearby wandering, and optional Doubao TTS output.
- Odyssey agent journey flow where an external AI can create journeys, save stops, and publish illustrated letters.
- Solo "Guess Where" game using satellite imagery, curated city entries, random backend locations, optional AI opponent, center-pin zoom reveals, score decay with zoom-aware distance tolerance, and lightweight sound/bubble feedback.
- Online 1v1 geography duel with private room codes, quick matchmaking, 100-second synchronized rounds, server-authoritative scoring, consistent color-coded pins, score-factor breakdowns, and reconnect-safe polling.
- Docker Compose deployment with an Nginx frontend/API proxy and a Go backend using SQLite.

## Quick Start

### Prerequisites

- Node.js 20+ and Yarn.
- Go 1.22.2+.
- Google Maps API key with Maps JavaScript API, Places API, Geocoding API, Street View API, and Static Maps API enabled.
- OpenRouter API key for AI descriptions and AI satellite guesses.
- Docker and Docker Compose for production-like deployment.

### Local Development

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Edit both .env files with real API keys.

make dev
```

The Vite frontend runs at [http://127.0.0.1:3100](http://127.0.0.1:3100) and proxies `/api` to the Go backend at `http://localhost:8080`. `make dev` and `make dev-start` also inject the local outbound proxy defaults from `LOCAL_PROXY_URL` for backend AI, Realtime, Doubao TTS, and Maps calls.

You can also run each side separately:

```bash
cd backend && go run cmd/server/main.go
cd frontend && yarn install && VITE_DEV_PORT=3100 yarn dev --host 127.0.0.1 --port 3100 --strictPort
```

Useful long-running dev helpers:

```bash
make dev-start    # background backend + frontend, logs in logs/dev/
make dev-stop     # stop background dev processes
```

## Common Commands

### Frontend

```bash
cd frontend
yarn dev          # Vite dev server, defaulting to port 3100 through VITE_DEV_PORT/vite.config.js
yarn build        # production build into frontend/build
yarn preview      # preview production build
yarn test         # Vitest test run
yarn typecheck    # TypeScript no-emit check
yarn lint         # ESLint
yarn format       # Prettier for src ts/tsx/css/md files
```

### Backend

```bash
cd backend
go run cmd/server/main.go
go test ./...

# Optional proxy flags
go run cmd/server/main.go --proxy http://127.0.0.1:10086
go run cmd/server/main.go --openai-proxy http://127.0.0.1:10086 --maps-proxy http://127.0.0.1:10086
```

### Deployment

```bash
make deploy       # docker compose build + up -d
make deploy-remote # ssh to REMOTE_HOST=kr, pull REMOTE_BRANCH (default main), deploy, and verify
make clean        # destructive: stop Compose and remove the SQLite data volume
```

For branch releases, push first and deploy the same branch so the local and VPS trees stay aligned:

```bash
git push origin "$(git branch --show-current)"
make deploy-remote REMOTE_BRANCH="$(git branch --show-current)"
```

Docker Compose exposes Nginx on `127.0.0.1:3000`; the backend is only exposed to the internal Compose network.

Deployment and data boundaries:

- `make deploy` changes the local Docker Compose runtime; `make deploy-remote` changes the configured remote host. Neither is a read-only verification command.
- `make clean` runs `docker compose down -v`, deleting the Compose-managed SQLite volume. Back up data first when it matters.
- `VITE_GOOGLE_MAPS_API_KEY` is delivered to the browser by design. Restrict it by allowed web origins and enabled APIs; never put server-only AI or Realtime credentials in `VITE_*` variables.
- Atlas footprints are derived from shared site-wide random-visit history. Session IDs are anonymous identifiers, but SQLite, logs, and public letters can still contain usage or user-authored content and should be handled accordingly.

## Configuration

Backend variables live in `backend/.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SERVER_ADDRESS` | No | Backend listen address, default `:8080`. |
| `SQLITE_PATH` | No | SQLite database path, default `data/streetview.db`. |
| `AI_API_KEY` | Yes | OpenRouter key used by AI services. |
| `OPENAI_API_KEY` or `REALTIME_API_KEY` | No | OpenAI key for Atlas Voice / Realtime. Required only when voice is enabled. |
| `OPENAI_REALTIME_MODEL` | No | Realtime voice model, default `gpt-realtime-2.1`. |
| `OPENAI_REALTIME_API_BASE`, `OPENAI_REALTIME_WS_URL` | No | Optional Realtime API base or explicit WebSocket URL override. Normally leave unset. |
| `OPENAI_REALTIME_VOICE` | No | Realtime output voice, default `cedar`. |
| `OPENAI_REALTIME_TRANSCRIPTION_MODEL` | No | Input transcription model, default `gpt-4o-mini-transcribe`. |
| `OPENAI_REALTIME_VAD_TYPE`, `OPENAI_REALTIME_VAD_EAGERNESS` | No | Realtime turn detection tuning, default `semantic_vad` with `high` eagerness for faster voice replies. |
| `OPENAI_REALTIME_VAD_THRESHOLD`, `OPENAI_REALTIME_VAD_PREFIX_PADDING_MS`, `OPENAI_REALTIME_VAD_SILENCE_DURATION_MS` | No | Optional `server_vad` tuning when `OPENAI_REALTIME_VAD_TYPE=server_vad`. Defaults are `0.5`, `250`, and `350`. |
| `OPENAI_REALTIME_ALLOWED_ORIGINS`, `REALTIME_ALLOWED_ORIGINS` | No | Comma-separated browser origins allowed to open the backend Realtime WebSocket. Same-origin and local dev hosts are allowed automatically. |
| `ATLAS_VOICE_PROVIDER` | No | Atlas Voice audio provider, default `openai`. Set to `doubao` to keep OpenAI Realtime for text/tools and synthesize speech with Doubao TTS. |
| `DOUBAO_TTS_API_KEY` | No | Doubao TTS API key for the new Volcengine console. Alternative to app ID plus access token. |
| `DOUBAO_TTS_APP_ID` / `DOUBAO_TTS_APPID`, `DOUBAO_TTS_ACCESS_KEY` / `DOUBAO_TTS_TOKEN` | No | Doubao TTS app credentials when not using `DOUBAO_TTS_API_KEY`. |
| `DOUBAO_TTS_SPEAKER` | No | Doubao TTS speaker / voice type, default `zh_male_m191_uranus_bigtts` (Yunzhou 2.0 male). |
| `DOUBAO_TTS_RESOURCE_ID` | No | Doubao TTS resource ID, default `seed-tts-2.0` for Doubao TTS 2.0 voices. |
| `DOUBAO_TTS_FORMAT`, `DOUBAO_TTS_SAMPLE_RATE` | No | Doubao TTS stream format and sample rate. Atlas currently expects `pcm` and defaults to `24000`. |
| `DOUBAO_TTS_SPEECH_RATE`, `DOUBAO_TTS_LOUDNESS_RATE`, `DOUBAO_TTS_EMOTION`, `DOUBAO_TTS_EMOTION_SCALE` | No | Optional Doubao speech tuning. |
| `DOUBAO_TTS_PROXY_URL` | No | Doubao-specific outbound proxy. Falls back to `AI_PROXY_URL` or `PROXY_URL`. |
| `OPENROUTER_MODEL`, `AI_MODEL` | No | Optional OpenRouter model override. `OPENROUTER_MODEL` takes precedence. |
| `CN_AI_MODEL` | No | Optional fallback model used only when no AI/shared proxy is configured. |
| `OPENROUTER_PROVIDER_SORT` | No | OpenRouter provider preference: `latency` (default), `throughput`, `price`, or `off`. |
| `GOOGLE_API_KEY` | Yes | Backend Google Maps, Street View, and Static Maps access. |
| `GOOGLE_MAPS_MAP_ID` | No | Optional map ID, mainly useful to mirror frontend config. |
| `SENTRY_DSN` | No | Backend Sentry DSN. |
| `GO_ENV` | No | Backend runtime environment and Sentry environment label, default `development`. |
| `SENTRY_ENABLED` | No | Set to `false` to disable backend Sentry initialization. |
| `RATE_LIMIT_ENABLED` | No | Enables SQLite-backed rate limiting, default `true`. |
| `RATE_LIMIT_MAX_REQUESTS` | No | Default rate-limit ceiling. Some handlers override per endpoint. |
| `RATE_LIMIT_WINDOW_SECONDS` | No | Default rate-limit window. |
| `MAP_DATA_AUTO_UPDATE` | No | Set to `true` to refresh local Natural Earth map data during geo initialization. Defaults to local-only startup. |
| `CORS_ALLOWED_ORIGINS` | No | Loaded into backend config and reported by `/health`; production CORS headers are added by Nginx. |
| `CORS_MAX_AGE` | No | Loaded into backend config, default `86400`. |
| `PROXY_URL`, `PROXY_TYPE`, `PROXY_USER`, `PROXY_PASS` | No | Shared outbound proxy config. |
| `AI_PROXY_URL`, `MAPS_PROXY_URL` | No | Service-specific outbound proxy overrides. |

Frontend variables live in `frontend/.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | No | Historical config value; current browser API wrappers call same-origin `/api/v1`. |
| `VITE_GOOGLE_MAPS_API_KEY` | Yes | Google Maps JavaScript API key for browser maps. |
| `VITE_GOOGLE_MAPS_MAP_ID` | No | Optional Google Maps map ID for configured maps. |
| `VITE_REALTIME_TRANSPORT` | No | Atlas Voice transport, default `backend-ws`; set to another value to use the WebRTC path. |
| `VITE_REALTIME_TRANSCRIPTION_MODEL` | No | Browser session-update override for input transcription, default `gpt-4o-mini-transcribe`. |
| `VITE_REALTIME_VOICE` | No | Browser session-update output voice, default `cedar`. |
| `VITE_REALTIME_OUTPUT_SPEED` | No | Browser session-update output speed, default `1`. |
| `VITE_REALTIME_VAD_TYPE`, `VITE_REALTIME_VAD_EAGERNESS` | No | Browser session-update turn detection tuning, default `semantic_vad` with `high` eagerness. |
| `VITE_REALTIME_VAD_THRESHOLD`, `VITE_REALTIME_VAD_PREFIX_PADDING_MS`, `VITE_REALTIME_VAD_SILENCE_DURATION_MS` | No | Browser `server_vad` tuning when `VITE_REALTIME_VAD_TYPE=server_vad`. |
| `VITE_REALTIME_RESPONSE_WATCHDOG_MS` | No | Voice UI no-response notice timeout, default `9000`. |
| `VITE_ATLAS_VOICE_PROVIDER` | No | Optional frontend override for the audio provider. Usually leave unset and let the backend `/api/v1/realtime/voice-config` drive it. |
| `VITE_REALTIME_AUDIO_PROVIDER` | No | Backward-compatible alias for the frontend voice provider override. |
| `VITE_SENTRY_DSN` | No | Frontend Sentry DSN. |
| `VITE_SENTRY_ENVIRONMENT` | No | Frontend Sentry environment. |
| `VITE_VERSION` | No | Included in frontend Sentry release metadata. |

## User Routes

- `/` - random Street View explorer.
- `/footprints` - shareable Atlas footprint map overlay.
- `/agent` - Odyssey setup and instructions for an external AI traveler.
- `/agent/letter/:id` - public Odyssey letter.
- `/guess` - solo satellite guessing game.
- `/guess/online` - online duel lobby with private room and matchmaking entry points.
- `/guess/online/:roomId` - online duel room.
- `/geo`, `/geo/online`, and `/geo/online/:roomId` - legacy redirects to the `/guess` routes.

## API Summary

All standard JSON endpoints return a `{ "success": boolean, "data": ..., "error": ... }` shape. Browser requests include `X-Session-ID`; the backend generates one if missing.

### Locations and Preferences

- `GET /api/v1/locations/random`
- `GET /api/v1/locations/lookup`
- `GET /api/v1/locations/search` - resolves a concrete place/landmark query through Google Places/Geocoding, then loads nearby Street View.
- `GET /api/v1/locations/:panoId/description`
- `GET /api/v1/locations/:panoId/detailed-description`
- `GET /api/v1/locations/:panoId/streetview-frame` - returns the current heading/pitch/FOV frame used by text and voice Atlas.
- `GET /api/v1/visits` - shared site-wide visit history; accepts `source=random|shared|lookup|map_pick`. Atlas footprints request `source=random`.
- `POST /api/v1/preferences/exploration`
- `POST /api/v1/preferences/exploration/remove`

### Odyssey Agent Journey

- `POST /api/v1/agent/journeys`
- `GET /api/v1/agent/journeys`
- `GET /api/v1/agent/journeys/:id`
- `PUT /api/v1/agent/journeys/:id/status`
- `GET /api/v1/agent/journeys/:id/public-letter`
- `GET /api/v1/agent/explore`
- `GET /api/v1/agent/streetview`
- `POST /api/v1/agent/journeys/:id/stops`
- `GET /api/v1/agent/journeys/:id/stops`
- `POST /api/v1/agent/journeys/:id/letter`

### Atlas Voice / Realtime

- `GET /api/v1/realtime/voice-config` - returns the active speech provider and Doubao TTS readiness.
- `GET /api/v1/realtime/client-secret` - creates a short-lived OpenAI Realtime session for the WebRTC path.
- `POST /api/v1/realtime/calls` - proxies WebRTC SDP offers to OpenAI Realtime.
- `GET /api/v1/realtime/ws` - same-origin WebSocket relay for the default voice transport.
- `POST /api/v1/realtime/doubao-tts` - streams Doubao TTS PCM chunks as NDJSON when `ATLAS_VOICE_PROVIDER=doubao`.

### Geo Game and Online Duel

- `GET /api/v1/geo/satellite`
- `POST /api/v1/geo/ai-guess`
- `POST /api/v1/geo/online/rooms`
- `POST /api/v1/geo/online/rooms/join`
- `GET /api/v1/geo/online/rooms/:roomId`
- `POST /api/v1/geo/online/rooms/:roomId/ready`
- `POST /api/v1/geo/online/rooms/:roomId/zoom-out`
- `POST /api/v1/geo/online/rooms/:roomId/guess`
- `POST /api/v1/geo/online/rooms/:roomId/leave`
- `GET /api/v1/geo/online/rooms/:roomId/image`
- `POST /api/v1/geo/online/matchmaking`
- `GET /api/v1/geo/online/matchmaking`
- `DELETE /api/v1/geo/online/matchmaking`

## Architecture Notes

The frontend is React 18 on Vite. Route components for Odyssey, solo geo game, and online duel are lazy loaded. The backend is a Gin server with SQLite persistence for locations, preferences, visit history, rate limits, and Odyssey journeys. The online duel room state is currently in memory inside `GeoBattleService`; it is not persisted across backend restarts.

See [docs/architecture.md](docs/architecture.md) for the state model and data flow, and [docs/runbook.md](docs/runbook.md) for setup, smoke tests, and troubleshooting.

## Project Structure

```text
frontend/
  src/
    components/      reusable UI, map components, and AtlasVoicePanel
    pages/           HomePage, AgentPage, LetterPage, GeoGamePage, GeoBattlePage
    services/        browser API wrappers
    store/           Zustand application store
    utils/           maps, session, scoring, voice runtime, and geography utilities
backend/
  cmd/server/        backend entrypoint
  internal/api/      Gin handlers, routes, middleware
  internal/atlas/    shared Atlas persona and Realtime instructions
  internal/services/ location, AI, maps, and online duel services
  internal/repositories/ SQLite repository and migrations
  internal/models/   API and domain models
  internal/openai/   OpenRouter client
  internal/utils/    geography, proxy, logging, map-data helpers
docs/                architecture and operations notes
nginx/               production Nginx image and proxy config
```

## License

MIT
