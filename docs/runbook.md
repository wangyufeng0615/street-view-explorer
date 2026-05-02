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
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:3000/api/v1/geo/satellite?lat=0&lng=0&zoom=21'
```

`docker-compose.yml` maps only `127.0.0.1:3000:3000`. Put a public reverse proxy in front of it if exposing the service.

Backend data lives in the `sqlite_data` Docker volume. `make clean` removes that volume.

The invalid geo satellite request above should return `400`; it verifies that the backend serving production traffic enforces the 2-14 zoom range.

### Remote Deploy From Local

Use this after pushing the target branch:

```bash
git push
make deploy-remote
```

Defaults:

```bash
REMOTE_HOST=kr
REMOTE_DIR=/root/street-view-explorer
REMOTE_BRANCH=main
LOCAL_GIT_REMOTE=origin
REMOTE_GIT_REMOTE=origin
HEALTH_TIMEOUT=240
```

`make deploy-remote` runs on the VPS: `git fetch`, `git checkout`, `git pull --ff-only`, `make deploy`, then waits for backend and nginx health checks. It also verifies backend `/health`, nginx `/nginx_status` from inside the nginx container, prints container/image IDs and start times, and checks that pano IDs containing `.` are no longer rejected by input validation. If the local remote name differs from the VPS remote name, set `LOCAL_GIT_REMOTE` and `REMOTE_GIT_REMOTE` separately.

For the public site, also smoke the SPA and geo backend path from outside the VPS:

```bash
curl -I https://earth.wangyufeng.org/geo
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://earth.wangyufeng.org/api/v1/geo/satellite?lat=0&lng=0&zoom=21'
```

The second command should return `400` after a release containing the geo zoom validation.

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
- For `GET /api/v1/geo/satellite`, inspect backend logs for Google Static Maps status codes. New backend logs redact `GOOGLE_API_KEY` from map fetch errors.
- In proxy-restricted networks, set `MAPS_PROXY_URL` or shared `PROXY_URL`.
- Do not share raw old backend logs without checking for Google Static Maps URLs. Logs generated before 2026-05-03 can contain full request URLs from older error paths.

### AI descriptions or AI guesses fail

- Verify `AI_API_KEY`.
- In proxy-restricted networks, set `AI_PROXY_URL` or shared `PROXY_URL`. A direct OpenRouter response like `This model is not available in your region` means the key and model can be valid while the current egress region is blocked.
- If you need a model override, set `OPENROUTER_MODEL` or `AI_MODEL`. `CN_AI_MODEL` is used only when no AI/shared proxy is configured.
- AI endpoints can take longer than normal JSON calls; frontend default timeout is 25 seconds, detailed descriptions use 30 seconds. The backend retries transient OpenRouter statuses (`408`, `429`, and `5xx`) within its request timeout.

### Online duel room disappears

- Online duel state is in backend memory and is lost on backend restart.
- Finished rooms are cleaned after 45 minutes.
- Lobby rooms are cleaned after 2 hours of inactivity.
- Matchmaking queue entries expire after 10 minutes without polling.

### Online duel image not ready

- `/image` returns a conflict before rounds are prepared.
- Wait for the room phase to move out of `lobby` or `preparing`.
- If preparation fails, the room returns to `lobby` with `prepare_failed` and both players must ready up again.

### Backend startup waits on map data

- Existing local Natural Earth map data is used by default; startup does not remote-check for updates.
- To refresh map data during geo initialization, set `MAP_DATA_AUTO_UPDATE=true`.

### Rate limits

- SQLite-backed rate limiting is enabled by default.
- `/api/v1/locations/random` has a per-IP limit of 120 requests per minute.
- `/api/v1/geo/ai-guess` has a per-IP limit of 30 requests per minute.
- `/api/v1/geo/satellite` and `/api/v1/geo/online/rooms/:roomId/image` have a per-IP limit of 180 requests per minute.
- `/api/v1/preferences/exploration` has tighter per-IP and per-session limits.
- Set `RATE_LIMIT_ENABLED=false` only for local debugging.
