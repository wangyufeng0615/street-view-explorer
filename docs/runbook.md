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

Local development is fixed at `http://127.0.0.1:3100` for the Vite frontend and `http://127.0.0.1:8080` for the backend. `make dev` and `make dev-start` set `SERVER_ADDRESS=127.0.0.1:8080`, `VITE_DEV_PORT=3100`, and proxy-related environment variables from `LOCAL_PROXY_URL` (`http://127.0.0.1:10086` by default).

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

Atlas Voice backend smoke:

```bash
curl -s http://localhost:8080/api/v1/realtime/voice-config
curl -s 'http://localhost:8080/api/v1/realtime/client-secret?lang=zh'
```

The first response should show `success: true`. The second requires `OPENAI_API_KEY` or `REALTIME_API_KEY`; failures there usually mean missing credentials, blocked egress, or proxy misconfiguration.

Atlas visual-context smoke (replace the panorama ID with one returned by a location endpoint):

```bash
curl -o /tmp/atlas-frame.jpg \
  'http://localhost:8080/api/v1/locations/PANO_ID/streetview-frame?heading=90&pitch=0&fov=90'
file /tmp/atlas-frame.jpg
```

The response should be a non-empty `640x480` JPEG or PNG. Text description requests accept the same view parameters and an optional `scene_pano_id` when the user has moved to a linked panorama.

For the streaming text path, add `stream=1`; a healthy response uses `text/event-stream`, emits `delta` events, and finishes with `done`. A terminal `error` event means validation or generation failed; final language validation also applies after visible streaming has begun. `research_status=verified` means the provider reported at least one search request. `unverified` means the provider did not confirm execution; the UI explicitly shows that uncertainty. A required tool choice is a request, not execution evidence. Atlas letter bodies are never cached: repeated requests generate fresh researched prose. Only location metadata and Street View frames have bounded TTL caches.

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
docker compose exec -T nginx wget -qO- http://127.0.0.1:3000/nginx_status
docker compose exec -T backend /app/main health
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
REMOTE_HOST=sg
REMOTE_DIR=/opt/street-view-explorer
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
DOUBAO_TTS_PROXY_URL=http://127.0.0.1:10086
```

OpenAI Realtime uses `AI_PROXY_URL` or `PROXY_URL`. Doubao TTS uses `DOUBAO_TTS_PROXY_URL` first, then falls back to the same Realtime proxy path. `make dev` and `make dev-start` set the shared proxy variables automatically for local development.

Use `--skip-proxy-check` only when the proxy health check itself is unreliable but the proxy path is known to work.

## Troubleshooting

### Frontend cannot reach API

- In development, confirm Vite is running on port 3100 and backend on 8080.
- Check `frontend/vite.config.js`: `/api` is proxied to `http://localhost:8080`.
- Browser API wrappers use same-origin `/api/v1`; changing `VITE_API_BASE_URL` alone will not reroute calls.

### Atlas Voice stays connecting

- Confirm backend is actually listening on `127.0.0.1:8080`; a live Vite server on `3100` can still show proxy errors if backend died.
- Check `logs/dev/frontend.log` for `/api/v1/realtime/ws` or `/api/v1/realtime/client-secret` proxy failures such as `ECONNREFUSED`.
- Check `logs/dev/backend.log` for `[ATLAS_VOICE]` lines. `client_secret_error` points to credentials, upstream status, or proxy egress; `ws_connect_error` points to WebSocket egress or Realtime URL/model issues.
- Verify `curl -s http://localhost:8080/api/v1/realtime/voice-config` and `curl -s 'http://localhost:8080/api/v1/realtime/client-secret?lang=zh'`.
- For local proxy-restricted networks, start through `make dev` / `make dev-start`, or set `AI_PROXY_URL` / `PROXY_URL` before launching backend manually.
- If `ATLAS_VOICE_PROVIDER=doubao`, make sure `/voice-config` reports `doubao_configured: true`; otherwise the UI keeps text output and reports the missing TTS credentials instead of playing speech.

### Google Maps or satellite images fail

- Verify `VITE_GOOGLE_MAPS_API_KEY` for browser Maps JavaScript API.
- Verify backend `GOOGLE_API_KEY` for Static Maps and server-side Maps calls.
- For `GET /api/v1/geo/satellite`, inspect backend logs for Google Static Maps status codes. New backend logs redact `GOOGLE_API_KEY` from map fetch errors.
- In proxy-restricted networks, set `MAPS_PROXY_URL` or shared `PROXY_URL`.
- Do not share raw old backend logs without checking for Google Static Maps URLs. Logs generated before 2026-05-03 can contain full request URLs from older error paths.

### AI descriptions or AI guesses fail

- Reverse geocoding uses one non-Plus-Code address candidate for locality fields; it does not combine a road address with a nearby school's locality. Description prompts also retain the visitor's Street View address as an anchor. Conflicting locality evidence must be qualified, and changing statistics require a matching geographic scope and year. These are grounding constraints, not a guarantee that generated facts are correct.
- Chinese descriptions reject embedded English prose such as `把Back往` before that sentence is streamed. Parenthesized original names and uppercase acronyms remain allowed. A rejected generation uses the existing error/retry flow.

- Verify `AI_API_KEY`.
- In proxy-restricted networks, set `AI_PROXY_URL` or shared `PROXY_URL`. A direct OpenRouter response like `This model is not available in your region` means the key and model can be valid while the current egress region is blocked.
- Atlas descriptions fetch the current Street View frame in parallel with reverse geocoding and send it to `OPENROUTER_SCENE_MODEL` (default `deepseek/deepseek-v4-flash-vision-exp`). A frame-fetch failure is visible and stops generation so Atlas cannot pretend to see a missing image. Text-only interest-region generation remains on `OPENROUTER_MODEL` / `AI_MODEL` (default `deepseek/deepseek-v4-flash`). Geo Guess uses `OPENROUTER_VISION_MODEL` (default `deepseek/deepseek-v4-flash-vision-exp`), disables model reasoning, and caps output at 480 tokens to stay within its 30-second request budget. `CN_AI_MODEL` is used only when no AI/shared proxy is configured.
- Geo Guess prefers vision providers sorted by latency. Description requests leave provider sorting unset so OpenRouter Auto Exacto can prioritize web-tool reliability. Set `OPENROUTER_PROVIDER_SORT=throughput`, `price`, or `off` to change the Geo Guess policy.
- AI endpoints can take longer than normal JSON calls; the streaming frontend timeout is 45 seconds for the first Atlas letter and 75 seconds for the detailed follow-up. These include frame/geocoding preparation and transport in addition to the model budgets (25 and 60 seconds). The backend retries transient OpenRouter statuses (`408`, `429`, and `5xx`) before streaming begins. OpenRouter usage logs should show at least one web-search request for either description path.

### Street View is black while its controls remain visible

- Load the Google Maps JavaScript SDK once per page. App language changes update app text, the country suffix (when an ISO country code is available), and AI text; Google's own map labels and controls retain the SDK's initial language until a reload. Do not delete Maps globals, scripts, or every `.gm-style` element to switch language. Street View cleanup hides and unbinds the old panorama and removes its owned DOM before replacement.

- First compare the same pano through `GET /api/v1/locations/:panoId/streetview-frame` or Google Maps. If that image works while the JavaScript panorama is black, inspect the document CSP before discarding the pano.
- Community-contributed Photo Spheres can load tiles from `https://*.googleusercontent.com`, while Google-owned panoramas commonly use `https://*.googleapis.com`. Both must remain in the Nginx `img-src` directive. Maps render workers also require `worker-src blob:`; keep this policy aligned with Google's [Maps JavaScript API CSP guide](https://developers.google.com/maps/documentation/javascript/content-security-policy).
- Run `make check-config` after editing `nginx/conf.d/default.conf`; deployment runs the same check automatically.

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
- Paid description limits are 12 standard and 6 detailed requests per IP per minute, with global hourly budgets of 360 and 120 respectively. A limiter storage failure intentionally returns `503` before an OpenRouter request is made.
- Odyssey clients should send traveler IDs only as `Authorization: Bearer <ID>`. Query-token support is legacy compatibility and must not be used in generated letters or browser URLs.
- `/api/v1/locations/random` has a per-IP limit of 120 requests per minute.
- `/api/v1/locations/search` has a per-IP limit of 45 requests per minute.
- `/api/v1/geo/ai-guess` has a per-IP limit of 30 requests per minute.
- `/api/v1/geo/satellite` and `/api/v1/geo/online/rooms/:roomId/image` have a per-IP limit of 180 requests per minute.
- `/api/v1/realtime/client-secret`, `/api/v1/realtime/calls`, `/api/v1/realtime/ws`, and `/api/v1/realtime/doubao-tts` have a per-IP limit of 20 requests per minute.
- `/api/v1/realtime/voice-config` has a per-IP limit of 120 requests per minute.
- `/api/v1/preferences/exploration` has tighter per-IP and per-session limits.
- Set `RATE_LIMIT_ENABLED=false` only for local debugging.

## Reliability and deployment controls

- SQLite uses modernc `_pragma` connection options: WAL, 5-second busy timeout, NORMAL synchronous mode, and foreign keys. Regression tests read them back on replacement connections. Back up with SQLite's online backup API (including while WAL is active), never copy just a live `.db` file.
- `/health` checks database connectivity; `/app/main health` checks HTTP status and the JSON health contract within 2.5 seconds without an outbound proxy. Docker health checks use this command.
- Set `TRUSTED_PROXY_CIDRS` to the actual trusted proxy hop ranges; the default trusts no forwarding headers. The public edge must preserve the real client address while rejecting arbitrary client-supplied forwarding chains. Never use `0.0.0.0/0` or `::/0`.
- Realtime WebSockets allow at most 16 simultaneous connections process-wide, 2 per client IP, 4 MiB per message, 15 minutes per session, 90 seconds read inactivity, and a 10-second write deadline. Reconnect after the session limit. These bounds supplement the per-minute HTTP limiter; they do not apply to direct WebRTC sessions.
- Online duel preparation has a 45-second budget and is cancelled when a player leaves. Guess and zoom requests reject expired deadlines even before a timer changes phase.
- `/api/v1/visits?source=random&distinct=1` paginates unique panoramas. The footprints page requests at most 5000 places, states the loaded count separately from the total, and clusters markers by map zoom.
- The source checkout may be owned by the SSH login user while Docker requires sudo. Use `REMOTE_SUDO=1`; the deploy script trusts only the selected checkout for that process. It requires actual health checks, a missing-panorama 404, and invalid-zoom 400. It never prints raw production logs on failure.

### SG production target (verified 2026-09-05)

The active target is `sg:/opt/street-view-explorer` (SSH user `ubuntu`, sudo for Docker), behind Caddy on `earth.wangyufeng.org`. KR's Docker service is inactive. The original archive matched commit `106364f` before its Git metadata was restored; local `.env` files and the existing `street-view-explorer_sqlite_data` volume are retained.

The host requires Git, GNU Make, curl, and Docker with Compose v2 and a running daemon. The deployment script checks these before changing the checkout. GNU Make was installed on SG on 2026-09-05; no host reboot is needed for application deployment.

```bash
make deploy-remote REMOTE_HOST=sg REMOTE_DIR=/opt/street-view-explorer REMOTE_BRANCH=main REMOTE_SUDO=1
```

Before changing a release, record its commit and container image IDs and create an online SQLite backup plus a protected source/config archive under `/var/backups/streetview/`. For rollback, use the recorded prior image IDs for both services, retain the same Compose project and data volume, and repeat health and API checks. Do not run `make clean`: it deletes the data volume. A database restore requires stopping the backend and separately confirming data retention; application rollback alone does not restore an older database.
