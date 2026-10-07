# Street View Explorer

[![Live Demo](https://img.shields.io/badge/Live-earth.wangyufeng.org-blue)](https://earth.wangyufeng.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](https://go.dev/)
[![React Version](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7.1-646CFF?logo=vite)](https://vitejs.dev/)

An interactive map application for exploring random Google Street View locations, generating AI location descriptions, and playing satellite-image geography games.

## Features

- Coverage-aware global exploration with broad/fair/frontier country lanes, bounded Street View snapping, and session-level repeat avoidance.
- Streamed Atlas letters and detailed follow-ups through OpenRouter, grounded in the Street View frame the user is currently facing and requesting server-side web search, with explicit verification status when provider evidence is unavailable.
- Visit history, a shared site-wide Atlas random-exploration footprint map, and regional or custom exploration preferences.
- Bilingual UI in English and Chinese.
- Atlas Voice on the home route, with the latest Street View frame as Realtime visual context, interruptible spoken turns, concrete place search, nearby wandering, and optional Doubao TTS output.
- Odyssey agent journey flow where an external AI can create journeys, save stops, and publish illustrated letters.
- Solo "Guess Where" game using satellite imagery, curated city entries, random backend locations, optional AI opponent, center-pin zoom reveals, score decay with zoom-aware distance tolerance, and lightweight sound/bubble feedback.
- Online 1v1 geography duel with private room codes, quick matchmaking, 100-second synchronized rounds, server-authoritative scoring, consistent color-coded pins, score-factor breakdowns, and reconnect-safe polling.
- Docker Compose deployment with an Nginx frontend/API proxy and a Go backend using SQLite.

## Quick Start

### Prerequisites

- Node.js 20.19+ (or 22.12+) and Yarn.
- Go 1.25.0+.
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
yarn typecheck    # TypeScript + opted-in JS/JSX + compile-only contract checks
yarn lint         # ESLint
yarn format       # Prettier for src js/jsx/ts/tsx/css/json/md files
yarn format:check # Read-only formatting check, also required by CI
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
make deploy-remote # ssh to REMOTE_HOST=sg (sudo), pull REMOTE_BRANCH (default main), deploy, and verify
make check        # nginx CSP, backend tests, frontend format/lint/typecheck/tests/build
make check-cleanup # real Docker cleanup test using an isolated disposable volume
make clean        # stop/remove Compose containers and networks; retain SQLite
```

For branch releases, push first and deploy the same branch so the local and VPS trees stay aligned:

```bash
git push origin "$(git branch --show-current)"
make deploy-remote REMOTE_BRANCH="$(git branch --show-current)"
```

Docker Compose exposes Nginx on `127.0.0.1:3000`; the backend is only exposed to the internal Compose network.

Deployment and data boundaries:

- `make deploy` changes the local Docker Compose runtime; `make deploy-remote` changes the configured remote host. Neither is a read-only verification command.
- `make clean` preserves the Compose-managed SQLite volume. Only `make destroy-data CONFIRM_DELETE_DATA=yes` deletes it; back up data first.
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
| `OPENAI_REALTIME_MODEL` | No | Realtime voice model, default `gpt-realtime-2.1-mini`. |
| `OPENAI_REALTIME_API_BASE`, `OPENAI_REALTIME_WS_URL` | No | Optional Realtime API base or explicit WebSocket URL override. Normally leave unset. |
| `OPENAI_REALTIME_VOICE` | No | Realtime output voice, default `cedar`. |
| `OPENAI_REALTIME_TRANSCRIPTION_MODEL` | No | Input transcription model, default `gpt-4o-mini-transcribe`. |
| `OPENAI_REALTIME_VAD_TYPE`, `OPENAI_REALTIME_VAD_EAGERNESS` | No | Realtime turn detection tuning, default `semantic_vad` with `high` eagerness for faster voice replies. |
| `OPENAI_REALTIME_VAD_THRESHOLD`, `OPENAI_REALTIME_VAD_PREFIX_PADDING_MS`, `OPENAI_REALTIME_VAD_SILENCE_DURATION_MS` | No | Optional `server_vad` tuning when `OPENAI_REALTIME_VAD_TYPE=server_vad`. Defaults are `0.5`, `250`, and `350`. |
| `OPENAI_REALTIME_ALLOWED_ORIGINS` | No | Comma-separated browser origins allowed to open the backend Realtime WebSocket. Same-origin and local dev hosts are allowed automatically. |
| `REALTIME_WEBRTC_ENABLED` | No | Enables the legacy WebRTC endpoints (`/realtime/client-secret`, `/realtime/calls`). Default `false`; enable only with `VITE_REALTIME_TRANSPORT=webrtc`. |
| `ATLAS_VOICE_PROVIDER` | No | Atlas Voice audio provider, default `openai`. Production sets `doubao`, which keeps OpenAI Realtime for text/tools and synthesizes speech with Doubao TTS. |
| `DOUBAO_TTS_API_KEY` | No | Doubao TTS API key for the new Volcengine console. Alternative to app ID plus access token. |
| `DOUBAO_TTS_APP_ID`, `DOUBAO_TTS_ACCESS_KEY` | No | Doubao TTS app credentials when not using `DOUBAO_TTS_API_KEY`. |
| `DOUBAO_TTS_APP_KEY` | No | Optional `X-Api-App-Key` header for app-credential accounts that require it. |
| `DOUBAO_TTS_ENDPOINT` | No | Doubao TTS endpoint, default `https://openspeech.bytedance.com/api/v3/tts/unidirectional`. |
| `DOUBAO_TTS_SPEAKER` | No | Doubao TTS speaker / voice type, default `zh_male_m191_uranus_bigtts` (Yunzhou 2.0 male). |
| `DOUBAO_TTS_RESOURCE_ID` | No | Doubao TTS resource ID, default `seed-tts-2.0` for Doubao TTS 2.0 voices. |
| `DOUBAO_TTS_FORMAT`, `DOUBAO_TTS_SAMPLE_RATE` | No | Doubao TTS stream format and sample rate. Atlas currently expects `pcm` and defaults to `24000`. |
| `DOUBAO_TTS_SPEECH_RATE`, `DOUBAO_TTS_LOUDNESS_RATE`, `DOUBAO_TTS_EMOTION`, `DOUBAO_TTS_EMOTION_SCALE` | No | Optional Doubao speech tuning. |
| `DOUBAO_TTS_PROXY_URL` | No | Doubao-specific outbound proxy. Falls back to `AI_PROXY_URL` or `PROXY_URL`. |
| `OPENROUTER_MODEL` | No | The single OpenRouter model for Atlas descriptions (with the current Street View frame), interest-region generation, and Geo Guess satellite-image analysis, default `deepseek/deepseek-v4.1-flash`. It must accept image input. Geo Guess disables model reasoning and caps the response to keep latency bounded. |
| `OPENROUTER_PROVIDER_SORT` | No | Geo Guess vision-provider preference: `latency` (default), `throughput`, `price`, or `off`. Description requests leave sorting unset for Auto Exacto tool routing. |
| `OPENROUTER_DESCRIPTION_PROVIDER_SORT` | No | Atlas description provider routing. Unset uses OpenRouter's automatic routing; `latency`, `throughput`, or `price` forces a sort. |
| `OPENROUTER_DESCRIPTION_SEARCH` | No | Set to `auto` to let OpenRouter choose the web-search engine; unset uses Exa fast search. |
| `OPENROUTER_API_ENDPOINT` | No | Chat completions endpoint, default `https://openrouter.ai/api/v1/chat/completions`. |
| `GOOGLE_API_KEY` | Yes | Backend Google Maps, Street View, and Static Maps access. |
| `SENTRY_DSN` | No | Backend Sentry DSN. |
| `GO_ENV` | No | Backend runtime environment and Sentry environment label, default `development`. |
| `SENTRY_ENABLED` | No | Set to `false` to disable backend Sentry initialization. |
| `SENTRY_SAMPLE_RATE` | No | Backend trace sample rate, default `0.1` in production and `1.0` elsewhere. |
| `SENTRY_RELEASE` | No | Backend Sentry release. `scripts/remote_deploy.sh` rewrites it to `streetview@<commit>` on each deploy. |
| `SENTRY_TEST_ENDPOINT_ENABLED` | No | Exposes `GET /test/sentry` in production when `true`; it is always available outside production. |
| `ENABLE_AI` | No | Default `true`. `false` skips the model call for Atlas descriptions (other AI features are unaffected). |
| `ENABLE_GOOGLE_API` | No | Default `true`. `false` makes Atlas descriptions skip reverse geocoding and the Street View frame. |
| `TRUSTED_PROXY_CIDRS` | No | Comma-separated CIDRs for the actual reverse proxy hops. Empty trusts no forwarding headers. |
| `RATE_LIMIT_ENABLED` | No | Enables SQLite-backed rate limiting, default `true`. Per-endpoint limits are defined in code. |
| `MAP_DATA_AUTO_UPDATE` | No | Set to `true` to refresh local Natural Earth map data during geo initialization. Defaults to local-only startup. |
| `PROXY_URL`, `PROXY_TYPE`, `PROXY_USER`, `PROXY_PASS` | No | Shared outbound proxy config. |
| `AI_PROXY_URL`, `MAPS_PROXY_URL` | No | Service-specific outbound proxy overrides. |

Frontend variables live in `frontend/.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | Yes | Google Maps JavaScript API key for browser maps. |
| `VITE_GOOGLE_MAPS_MAP_ID` | No | Optional Google Maps map ID for configured maps. |
| `VITE_REALTIME_TRANSPORT` | No | Atlas Voice transport, default `backend-ws`; set to another value to use the WebRTC path (requires backend `REALTIME_WEBRTC_ENABLED=true`). |
| `VITE_REALTIME_TRANSCRIPTION_MODEL` | No | Browser session-update override for input transcription, default `gpt-4o-mini-transcribe`. |
| `VITE_REALTIME_VOICE` | No | Browser session-update output voice, default `cedar`. |
| `VITE_REALTIME_OUTPUT_SPEED` | No | Browser session-update output speed, default `1`. |
| `VITE_REALTIME_VAD_TYPE`, `VITE_REALTIME_VAD_EAGERNESS` | No | Browser session-update turn detection tuning, default `semantic_vad` with `high` eagerness. |
| `VITE_REALTIME_VAD_THRESHOLD`, `VITE_REALTIME_VAD_PREFIX_PADDING_MS`, `VITE_REALTIME_VAD_SILENCE_DURATION_MS` | No | Browser `server_vad` tuning when `VITE_REALTIME_VAD_TYPE=server_vad`. |
| `VITE_REALTIME_RESPONSE_WATCHDOG_MS` | No | Voice UI no-response notice timeout, default `9000`. |
| `VITE_ATLAS_VOICE_PROVIDER` | No | Optional frontend override for the audio provider. Usually leave unset and let the backend `/api/v1/realtime/voice-config` drive it. |
| `VITE_SENTRY_DSN` | No | Frontend Sentry DSN. |
| `VITE_SENTRY_ENVIRONMENT` | No | Frontend Sentry environment. |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | No | Frontend trace sample rate, default `0.1` in production builds and `1.0` in development. |
| `VITE_VERSION` | No | Included in frontend Sentry release metadata. `scripts/remote_deploy.sh` rewrites it to the deployed commit. |
| `VITE_REALTIME_AUDIO_MAX_BUFFERED_BYTES` | No | Microphone frames are dropped while the voice WebSocket send buffer exceeds this many bytes, default `131072`. |
| `VITE_ASSISTANT_ECHO_TAIL_MS` | No | With Doubao output, microphone input stays muted this long after Atlas audio ends to avoid speaker echo, default `450`. |

`VITE_DEV_PORT` (default `3100`) and `VITE_API_PROXY_TARGET` (default `http://localhost:8080`) configure the Vite dev server. They are read from the shell environment, not from `frontend/.env`; `make dev` sets both.

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

The full endpoint list lives in the "API 路由" section of [AGENTS.md](AGENTS.md); `backend/internal/api/routes.go` is the source of truth. Rate limits are listed in [docs/runbook.md](docs/runbook.md#rate-limits).

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
