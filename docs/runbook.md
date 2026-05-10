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

For Atlas Voice local testing, also set `OPENAI_API_KEY` or `REALTIME_API_KEY` in `backend/.env`. Optional voice knobs are `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE` (default `cedar`), `OPENAI_REALTIME_TRANSCRIPTION_MODEL`, `OPENAI_REALTIME_VAD_TYPE`, `OPENAI_REALTIME_VAD_EAGERNESS`, and `OPENAI_REALTIME_ALLOWED_ORIGINS`. Atlas defaults to `semantic_vad` with `high` eagerness so spoken turns close quickly. The browser session update can also override `VITE_REALTIME_VOICE`, `VITE_REALTIME_OUTPUT_SPEED`, `VITE_REALTIME_VAD_TYPE`, `VITE_REALTIME_VAD_EAGERNESS`, and `VITE_REALTIME_RESPONSE_WATCHDOG_MS`.

To try Doubao as the speech output while keeping OpenAI Realtime for input, tools, and text generation, set `ATLAS_VOICE_PROVIDER=doubao` or pass `--voice-provider doubao`. The backend then asks OpenAI for text output and streams that text through Volcengine BigTTS (`DOUBAO_TTS_RESOURCE_ID`, default `seed-tts-2.0` for TTS 2.0 voices). Configure either `DOUBAO_TTS_API_KEY`, or `DOUBAO_TTS_APP_ID`/`DOUBAO_TTS_APPID` plus `DOUBAO_TTS_ACCESS_KEY`/`DOUBAO_TTS_TOKEN`; optional tuning includes `DOUBAO_TTS_SPEAKER` (default `zh_male_m191_uranus_bigtts`, Yunzhou 2.0 male) and `DOUBAO_TTS_SPEECH_RATE`.

```bash
cd backend
go run cmd/server/main.go --proxy http://127.0.0.1:10086 \
  --voice-provider doubao \
  --doubao-tts-api-key "$DOUBAO_TTS_API_KEY" \
  --doubao-tts-speaker zh_male_m191_uranus_bigtts
```

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

Atlas Voice origin smoke:

```bash
curl -i -H 'Origin: http://127.0.0.1:3100' \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  http://localhost:8080/api/v1/realtime/ws
```

Expected without a valid WebSocket handshake is a non-101 response, but it should not be a cross-origin rejection for local dev. A browser origin outside same-origin, localhost, or `OPENAI_REALTIME_ALLOWED_ORIGINS` should be rejected before it can proxy to OpenAI.

End-to-end local smoke:

```bash
curl -s -H 'X-Session-ID: 0123456789abcdef0123456789abcdef' \
  'http://localhost:8080/api/v1/locations/random?lang=en'

curl -I -H 'X-Session-ID: 0123456789abcdef0123456789abcdef' \
  'http://localhost:8080/api/v1/geo/satellite?lat=35.6586&lng=139.7454&zoom=14'
```

Online duel smoke with two sessions:

```bash
HOST=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
GUEST=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

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

After copying `room_id`, ready both players and confirm the countdown does not expose the satellite image yet:

```bash
ROOM_ID=room_xxx

curl -s -X POST "http://localhost:8080/api/v1/geo/online/rooms/$ROOM_ID/ready" \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: $HOST" \
  -d '{"ready":true}'

curl -s -X POST "http://localhost:8080/api/v1/geo/online/rooms/$ROOM_ID/ready" \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: $GUEST" \
  -d '{"ready":true}'

curl -s -o /dev/null -w '%{http_code}\n' \
  -H "X-Session-ID: $HOST" \
  "http://localhost:8080/api/v1/geo/online/rooms/$ROOM_ID/image"
```

Expected during `countdown`: `409`. Expected after the phase becomes `playing`: `200`. If both players submit guesses during `playing`, the snapshot should keep current-round guesses, target, and score hidden until the deadline-driven `reveal` phase.

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
git push origin "$(git branch --show-current)"
make deploy-remote REMOTE_BRANCH="$(git branch --show-current)"
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

The remote deploy script refuses to continue when tracked files in `REMOTE_DIR` are dirty. For an exact release mirror, clean or discard deliberate temporary remote-only files before deploying; do not leave a stash or `docker-compose.override.yml` unless it is intentionally part of operations.

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

- `/image` returns a conflict before the round is playable.
- Wait for the room phase to move out of `lobby`, `preparing`, or `countdown`.
- If preparation fails, the room returns to `lobby` with `prepare_failed` and both players must ready up again.

### Online duel reveals too early

- The backend should stay in `playing` until the phase deadline even if both players have submitted guesses.
- During `playing`, snapshots may show `has_submitted_this_round` / `opponent_locked`, but must not include target coordinates, opponent guess details, or current-round score deltas.
- If the UI reveals the satellite, target, or scores before `reveal`, compare the browser snapshot phase with the backend response before changing the service.

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
