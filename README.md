# Street View Explorer

[![Live Demo](https://img.shields.io/badge/Live-earth.wangyufeng.org-blue)](https://earth.wangyufeng.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go)](https://go.dev/)
[![React Version](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7.1-646CFF?logo=vite)](https://vitejs.dev/)

An interactive map application for exploring random Google Street View locations, generating AI location descriptions, and playing satellite-image geography games.

## Features

- Random global exploration with area-weighted location selection.
- AI-generated short and detailed descriptions through OpenRouter.
- Visit history, footprint map, and regional or custom exploration preferences.
- Bilingual UI in English and Chinese.
- Odyssey agent journey flow where an external AI can create journeys, save stops, and publish illustrated letters.
- Solo "Guess Where" game using satellite imagery, curated city entries, random backend locations, optional AI opponent, and score decay by zoom-outs plus distance.
- Online 1v1 geography duel with private room codes, quick matchmaking, synchronized rounds, server-authoritative scoring, and reconnect-safe polling.
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

The Vite frontend runs at [http://localhost:3000](http://localhost:3000) and proxies `/api` to the Go backend at `http://localhost:8080`.

You can also run each side separately:

```bash
cd backend && go run cmd/server/main.go
cd frontend && yarn install && yarn dev
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
yarn dev          # Vite dev server on port 3000
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
make clean        # docker compose down -v and remove containers
```

Docker Compose exposes Nginx on `127.0.0.1:3000`; the backend is only exposed to the internal Compose network.

## Configuration

Backend variables live in `backend/.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SERVER_ADDRESS` | No | Backend listen address, default `:8080`. |
| `SQLITE_PATH` | No | SQLite database path, default `data/streetview.db`. |
| `AI_API_KEY` | Yes | OpenRouter key used by AI services. |
| `GOOGLE_API_KEY` | Yes | Backend Google Maps, Street View, and Static Maps access. |
| `GOOGLE_MAPS_MAP_ID` | No | Optional map ID, mainly useful to mirror frontend config. |
| `SENTRY_DSN` | No | Backend Sentry DSN. |
| `GO_ENV` | No | Backend runtime environment and Sentry environment label, default `development`. |
| `SENTRY_ENABLED` | No | Set to `false` to disable backend Sentry initialization. |
| `RATE_LIMIT_ENABLED` | No | Enables SQLite-backed rate limiting, default `true`. |
| `RATE_LIMIT_MAX_REQUESTS` | No | Default rate-limit ceiling. Some handlers override per endpoint. |
| `RATE_LIMIT_WINDOW_SECONDS` | No | Default rate-limit window. |
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
| `VITE_SENTRY_DSN` | No | Frontend Sentry DSN. |
| `VITE_SENTRY_ENVIRONMENT` | No | Frontend Sentry environment. |
| `VITE_VERSION` | No | Included in frontend Sentry release metadata. |

## User Routes

- `/` - random Street View explorer.
- `/agent` - Odyssey setup and instructions for an external AI traveler.
- `/agent/letter/:id` - public Odyssey letter.
- `/geo` - solo satellite guessing game.
- `/geo/online` - online duel lobby with private room and matchmaking entry points.
- `/geo/online/:roomId` - online duel room.

## API Summary

All standard JSON endpoints return a `{ "success": boolean, "data": ..., "error": ... }` shape. Browser requests include `X-Session-ID`; the backend generates one if missing.

### Locations and Preferences

- `GET /api/v1/locations/random`
- `GET /api/v1/locations/lookup`
- `GET /api/v1/locations/:panoId/description`
- `GET /api/v1/locations/:panoId/detailed-description`
- `GET /api/v1/visits`
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
    components/      reusable UI and map components
    pages/           HomePage, AgentPage, LetterPage, GeoGamePage, GeoBattlePage
    services/        browser API wrappers
    store/           Zustand application store
    utils/           maps, session, scoring, and geography utilities
backend/
  cmd/server/        backend entrypoint
  internal/api/      Gin handlers, routes, middleware
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
