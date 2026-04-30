# Runbook

Operational notes for local development, smoke tests, deployment, and troubleshooting.

## Local Setup

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Fill at least:

- `backend/.env`: `AI_API_KEY`, `GOOGLE_API_KEY`.
- `frontend/.env`: `VITE_GOOGLE_MAPS_API_KEY`.

Start both services:

```bash
make dev
```

Or start in the background:

```bash
make dev-start
tail -f logs/dev/backend.log logs/dev/frontend.log
make dev-stop
```

## Verification Commands

Backend:

```bash
cd backend
go test ./...
curl -s http://localhost:8080/health
```

Frontend:

```bash
cd frontend
yarn test
yarn typecheck
yarn build
```

End-to-end local smoke:

```bash
curl -s -H 'X-Session-ID: 0123456789abcdef0123456789abcdef' \
  'http://localhost:8080/api/v1/locations/random?lang=en'

curl -I -H 'X-Session-ID: 0123456789abcdef0123456789abcdef' \
  'http://localhost:8080/api/v1/geo/satellite?lat=35.6586&lng=139.7454&zoom=14'
```

Online duel smoke with two sessions:

```bash
HOST=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
GUEST=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

curl -s -X POST http://localhost:8080/api/v1/geo/online/rooms \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: $HOST" \
  -d '{"nickname":"Host"}'

# Copy room_code from the response, then:
curl -s -X POST http://localhost:8080/api/v1/geo/online/rooms/join \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: $GUEST" \
  -d '{"nickname":"Guest","code":"ROOMCD"}'
```

The room does not start until both players post `ready: true`.

## Deployment

```bash
make deploy
docker compose ps
curl -s http://127.0.0.1:3000/nginx_status
curl -s http://127.0.0.1:3000/health
```

`docker-compose.yml` maps only `127.0.0.1:3000:3000`. Put a public reverse proxy in front of it if exposing the service.

Backend data lives in the `sqlite_data` Docker volume. `make clean` removes that volume.

## Proxy Operation

The backend supports shared and service-specific outbound proxy settings.

Command-line form:

```bash
cd backend
go run cmd/server/main.go --proxy http://127.0.0.1:10086
go run cmd/server/main.go --openai-proxy http://127.0.0.1:10086 --maps-proxy http://127.0.0.1:10086
```

Environment form:

```bash
PROXY_URL=http://127.0.0.1:10086
PROXY_TYPE=http
AI_PROXY_URL=http://127.0.0.1:10086
MAPS_PROXY_URL=http://127.0.0.1:10086
```

Use `--skip-proxy-check` only when the proxy health check itself is unreliable but the proxy path is known to work.

## Troubleshooting

### Frontend cannot reach API

- In development, confirm Vite is running on port 3000 and backend on 8080.
- Check `frontend/vite.config.js`: `/api` is proxied to `http://localhost:8080`.
- Browser API wrappers use same-origin `/api/v1`; changing `VITE_API_BASE_URL` alone will not reroute calls.

### Google Maps or satellite images fail

- Verify `VITE_GOOGLE_MAPS_API_KEY` for browser Maps JavaScript API.
- Verify backend `GOOGLE_API_KEY` for Static Maps and server-side Maps calls.
- For `GET /api/v1/geo/satellite`, inspect backend logs for Google Static Maps status codes.
- In proxy-restricted networks, set `MAPS_PROXY_URL` or shared `PROXY_URL`.

### AI descriptions or AI guesses fail

- Verify `AI_API_KEY`.
- In proxy-restricted networks, set `AI_PROXY_URL` or shared `PROXY_URL`.
- AI endpoints can take longer than normal JSON calls; frontend default timeout is 25 seconds, detailed descriptions use 30 seconds.

### Online duel room disappears

- Online duel state is in backend memory and is lost on backend restart.
- Finished rooms are cleaned after 45 minutes.
- Lobby rooms are cleaned after 2 hours of inactivity.
- Matchmaking queue entries expire after 10 minutes without polling.

### Online duel image not ready

- `/image` returns a conflict before rounds are prepared.
- Wait for the room phase to move out of `lobby` or `preparing`.
- If preparation fails, the room returns to `lobby` with `prepare_failed` and both players must ready up again.

### Rate limits

- SQLite-backed rate limiting is enabled by default.
- `/api/v1/locations/random` has a per-IP limit of 120 requests per minute.
- `/api/v1/preferences/exploration` has tighter per-IP and per-session limits.
- Set `RATE_LIMIT_ENABLED=false` only for local debugging.
