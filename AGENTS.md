# AGENTS.md

Street View Explorer - 随机全球街景探索、AI 讲解、AI 旅程，以及卫星图猜地理游戏。

## 常用命令

```bash
# 一次性前台启动前后端
make dev

# 后台启动/停止开发环境，日志在 logs/dev/
make dev-start
make dev-stop

# 前端
cd frontend && yarn dev
cd frontend && yarn build
cd frontend && yarn test
cd frontend && yarn typecheck
cd frontend && yarn lint

# 后端
cd backend && go run cmd/server/main.go
cd backend && go test ./...

# 部署
make deploy
make deploy-remote
make clean
```

后端代理启动参数：

```bash
cd backend
go run cmd/server/main.go --proxy http://127.0.0.1:10086
go run cmd/server/main.go --openai-proxy http://127.0.0.1:10086 --maps-proxy http://127.0.0.1:10086
```

## 项目结构

```text
frontend/src/
├── components/     # StreetView, GlobalMap, PreviewMap, Sidebar, TopBar, AtlasVoicePanel, GameFeedback 等
├── pages/          # HomePage, AgentPage, LetterPage, GeoGamePage, GeoBattlePage
├── hooks/          # useLocationData, useExplorationMode, useKeyboardNavigation, useGameFeedback 等
├── store/          # Zustand 状态管理
├── services/       # api.js，同源 /api/v1 包装
├── locales/        # en/zh 翻译
├── data/           # geoDatabase.js，单人猜地理题库
├── utils/          # googleMaps, session, geoGameUtils, atlasVoiceRuntime, atlasPersona, addressUtils
└── styles/         # 页面 CSS

backend/
├── cmd/server/        # main.go
├── internal/api/      # routes.go, handlers, middleware, geo online/realtime/tts handlers
├── internal/atlas/    # Atlas persona 与 Realtime instructions
├── internal/services/ # location, ai, maps, geo battle service
├── internal/repositories/ # SQLite repository + migrate
├── internal/models/   # location, journey, geo battle DTO
├── internal/openai/   # OpenRouter client
├── internal/sentry/   # Sentry 初始化和 Gin middleware
├── internal/config/   # 环境变量配置
└── internal/utils/    # 地理算法、map data、proxy、logger
```

## 关键约定

- API 响应格式默认是 `{ success: bool, data: ..., error: string }`。
- 浏览器请求通过 `X-Session-ID` 维持匿名会话；缺失时后端会生成新 session，并写回响应头。
- SQLite 使用 `modernc.org/sqlite`，WAL 模式，schema 在 `internal/repositories/sqliterepo.go` 的 `migrate()` 自动创建。
- Docker Compose 中后端数据库挂载在 `sqlite_data` volume，开发默认在 `backend/data/streetview.db`。
- 本地开发固定前端端口是 `127.0.0.1:3100`；`make dev` / `make dev-start` 会把 `LOCAL_PROXY_URL` 注入为 `PROXY_URL`、`AI_PROXY_URL`、`MAPS_PROXY_URL` 以及大小写 HTTP(S)/ALL 代理环境变量。
- Vite 构建输出目录是 `frontend/build`，Nginx Dockerfile 会复制这个目录。
- `frontend/src/services/api.js` 当前使用同源 `/api/v1`，`VITE_API_BASE_URL` 是历史配置字段，不要假设它会改变请求根路径。
- Atlas Voice 默认走 `backend-ws`：浏览器连 `/api/v1/realtime/ws`，后端用 `OPENAI_API_KEY` 或 `REALTIME_API_KEY` 连 OpenAI Realtime。所有本地外部请求都应走 `AI_PROXY_URL` / `PROXY_URL`，豆包 TTS 可额外用 `DOUBAO_TTS_PROXY_URL`。
- `CORSMiddleware()` 存在但 `main.go` 当前没有注册；部署态 CORS 主要由 `nginx/conf.d/default.conf` 处理。

## UI 路由

- `/` - 随机街景探索首页。
- `/footprints` - 可直接访问的 Atlas 足迹地图。
- `/agent` - Odyssey，给外部 AI 复制旅行 skill 和旅程入口。
- `/agent/letter/:id` - 公开旅程来信。
- `/guess` - 单人卫星图猜地理。
- `/guess/online` - 在线 1v1 对战大厅。
- `/guess/online/:roomId` - 在线对战房间。
- `/geo`、`/geo/online`、`/geo/online/:roomId` - 旧路由，前端重定向到对应 `/guess` 路由。

## API 路由

### 基础探索

- `GET /api/v1/locations/random` - 随机街景位置，支持 `lang` 和 `source`。
- `GET /api/v1/locations/lookup` - 根据坐标反查位置。
- `GET /api/v1/locations/search` - 通过 Google Places/Geocoding 搜索具体地点或地标，并跳到附近街景。
- `GET /api/v1/locations/:panoId/description` - AI 简短描述。
- `GET /api/v1/locations/:panoId/detailed-description` - AI 详细描述。
- `GET /api/v1/visits` - 全站共享的 Atlas 足迹历史；写入仍保留 session 作为账本字段，读取不按用户过滤。
- `POST /api/v1/preferences/exploration` - 设置探索偏好。
- `POST /api/v1/preferences/exploration/remove` - 删除探索偏好。

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

- `GET /api/v1/realtime/voice-config` - 返回当前语音提供方和豆包 TTS 配置状态。
- `GET /api/v1/realtime/client-secret` - 为 WebRTC 路径创建 OpenAI Realtime 临时 session。
- `POST /api/v1/realtime/calls` - 代理 WebRTC SDP 到 OpenAI Realtime。
- `GET /api/v1/realtime/ws` - 默认语音路径，同源 WebSocket relay，Vite 和 Nginx 都需要支持 upgrade。
- `POST /api/v1/realtime/doubao-tts` - `ATLAS_VOICE_PROVIDER=doubao` 时把 Atlas 文本回复转成豆包 PCM NDJSON 音频流。

### Geo Game

- `GET /api/v1/geo/satellite` - 代理 Google Static Maps 卫星图，参数 `lat,lng,zoom`。
- `POST /api/v1/geo/ai-guess` - 拉取同一卫星图并让 AI 猜测画面中心点坐标。

### Geo Online Duel

- `POST /api/v1/geo/online/rooms` - 创建好友房。
- `POST /api/v1/geo/online/rooms/join` - 使用 6 位房间码加入好友房。
- `GET /api/v1/geo/online/rooms/:roomId` - 获取房间快照。
- `POST /api/v1/geo/online/rooms/:roomId/ready` - 准备/取消准备。
- `POST /api/v1/geo/online/rooms/:roomId/zoom-out` - 当前轮拉远一级。
- `POST /api/v1/geo/online/rooms/:roomId/guess` - 提交猜测或 `{ give_up: true }`。
- `POST /api/v1/geo/online/rooms/:roomId/leave` - 离开房间。
- `GET /api/v1/geo/online/rooms/:roomId/image` - 当前轮卫星图，`Cache-Control: no-store`。
- `POST /api/v1/geo/online/matchmaking` - 加入随机匹配队列。
- `GET /api/v1/geo/online/matchmaking` - 查询匹配状态。
- `DELETE /api/v1/geo/online/matchmaking` - 取消匹配。

## Geo Game 实现要点

- 单人局总轮数来自 `frontend/src/utils/geoGameUtils.js` 的 `TOTAL_ROUNDS = 5`。
- 单人局起始 zoom 是 14，最小 zoom 是 2；后端 `GET /api/v1/geo/satellite` 和 `POST /api/v1/geo/ai-guess` 也校验 `zoom` 必须在 2-14。
- `GET /api/v1/geo/satellite` 可带 `width,height`，两者必须同时提供且每边在 120-640；单人和 AI 猜测会按当前卫星面板比例请求图片，缺省仍是 640x480。
- `generateRoundPlan()` 会从 `geoDatabase.js` 选 2 或 3 个题库点，其余使用后端随机位置；题库点会经过 `jitterCoord()` 小偏移。
- `GeoGamePage.jsx` 的 loading effect 使用 `langRef` 读取语言，避免语言切换重新抽题。
- 单人卫星图中心图钉必须始终可见；拉远时先加载下一张静态图，再用约 760ms 的 handoff 动画切换，避免闪烁。
- 简单音效和气泡提示通过 `useGameFeedback()` / `GameFeedback.jsx` 复用，单人模式的本地开关 key 是 `geoGameSound`。
- 计分公式在前后端一致：`5000 * exp(-zoomSteps * 0.12) * exp(-effectiveDistanceKm / 1500)`；`effectiveDistanceKm = max(0, distanceKm - min(100, 1 * 1.45^zoomSteps))`，拉远后容错半径会动态变大。
- Atlas AI 猜测只看到用户锁定结果时当前 zoom 的一张卫星图，不会看到前面每次拉远的历史图；prompt 明确要求猜这张图的中心点，并按 UI 语言返回 reasoning。
- 结果地图图钉颜色语义：绿色是正确位置，红色是玩家，紫色是 Atlas；结果文字区也按同一语义展示。
- 以前审查中关注过近邻题库点、`roundPlan` 生命周期和小轮数边界；修改这些文件时要补充相应测试。

## Geo Online Duel 实现要点

- 当前在线对战是固定 1v1，服务端权威状态保存在 `GeoBattleService` 的内存 map 中，后端重启会丢房间和匹配队列。
- 房间模式：`private` 和 `matchmaking`。
- 阶段：`lobby -> preparing -> countdown -> playing -> reveal -> finished`。
- 默认 5 轮，每轮 100 秒，reveal 8 秒，countdown 5 秒。
- 好友房需要双方 ready 后才开始；随机匹配成功后自动进入 preparing。
- 前端用 polling 同步状态：playing 约 1.5 秒，其余约 2.5 秒；服务端 `server_time` 用于修正倒计时。
- 房间码 6 位，来自 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`；昵称最多 20 个 rune，会去掉控制字符。
- `GET /image` 只在 `playing/reveal/finished` 可用；`lobby/preparing/countdown` 返回 image-not-ready，避免倒计时提前露出卫星图。
- `SubmitGuess` 只记录猜测，不会因为双方都锁定就直接 reveal；playing 阶段快照会隐藏当前轮猜测详情、目标和本轮新增分数，直到服务端 deadline 推进到 reveal。
- `GET /image` 根据当前玩家 zoom 返回同一目标卫星图；reveal/finished 阶段最多展示 zoom 5。
- 多人卫星图也必须显示中心图钉，并和单人模式使用一致的拉远 handoff 动画；加载新图时保留旧图，禁用地图交互避免误点。
- 多人颜色语义：红色是你，蓝色是对手，绿色是正确位置；这些颜色要在玩家卡片、地图图钉、气泡和结果文字里保持一致。
- 多人结果必须清晰展示拉远次数、时间剩余或不扣分状态、距离，以及 base/zoom/tolerance/distance/final 等计分权重。
- 多人音效和气泡提示也走 `useGameFeedback()` / `GameFeedback.jsx`，本地开关 key 是 `geoBattleSound`。
- 双人对战计分和单人局一致，也使用随拉远次数增长的动态容错半径；跳过或超时本轮为 0 分。
- finished 或 lobby 阶段离开会移除玩家；playing 等中途离开会直接结束房间。

## Atlas Voice 实现要点

- 前端入口是 `frontend/src/components/AtlasVoicePanel.jsx`，只挂在首页；运行时工具和 VAD 配置在 `frontend/src/utils/atlasVoiceRuntime.js`，共享 persona 在 `frontend/src/utils/atlasPersona.js` 和 `backend/internal/atlas/persona.go`。
- 默认传输是 `VITE_REALTIME_TRANSPORT=backend-ws`：浏览器连同源 `/api/v1/realtime/ws`，后端再连 OpenAI Realtime。WebRTC 兼容路径会先拿 `/client-secret`，再走 `/calls`。
- 默认 Realtime 模型是 `gpt-realtime-2.1`，输出音色 `cedar`，转写模型 `gpt-4o-mini-transcribe`，turn detection 是 `semantic_vad` + `high`，支持被用户打断。
- 工具集合刻意小：`explore_random`、`explore_interest`、`go_to_place`、`wander_nearby`、`look_direction`、`read_current_place`。具体地标/地址/店名要走 `go_to_place`，它会调用 `GET /api/v1/locations/search`。
- `ATLAS_VOICE_PROVIDER=doubao` 时 OpenAI Realtime 只负责听写、文本、记忆和工具调用，后端 `/doubao-tts` 负责把最终文本转成 PCM 流。前端会排队播放并用短窗口忽略豆包外放回灌。
- 后端 Realtime WebSocket origin 校验允许同源、本地 `localhost/127.0.0.1/::1`，生产额外域名用 `OPENAI_REALTIME_ALLOWED_ORIGINS` / `REALTIME_ALLOWED_ORIGINS`。

## 安全与日志注意

- `RateLimitMiddleware()` 默认开启；`/api/v1/locations/search` 是每 IP 每分钟 45 次；`/api/v1/geo/ai-guess` 是每 IP 每分钟 30 次；`/api/v1/geo/satellite` 和 `/api/v1/geo/online/rooms/:roomId/image` 是每 IP 每分钟 180 次；Realtime session / WebSocket / Doubao TTS 入口是每 IP 每分钟 20 次，`/api/v1/realtime/voice-config` 是 120 次。
- Google Static Maps 请求失败日志会隐藏 `GOOGLE_API_KEY`；不要把旧本地日志或生产日志原样外发，尤其是 2026-05-03 之前生成的地图错误日志。
- Realtime 日志以 `[ATLAS_VOICE]` 开头，包含时延、provider、VAD 摘要和工具输出摘要；不要记录或外发 `OPENAI_API_KEY`、`REALTIME_API_KEY`、`DOUBAO_TTS_API_KEY`、`DOUBAO_TTS_TOKEN`。
- 分支发布时先 push 当前分支，再用 `make deploy-remote REMOTE_BRANCH=$(git branch --show-current)`，保持本地、origin、VPS 三边一致；远端有 tracked dirty 文件时部署脚本会拒绝继续。
- 生产部署后至少确认 `docker compose ps`、后端 `/health`、nginx `/nginx_status`，再用一个非法 zoom 请求确认新后端已生效。

## 环境变量

后端必须配置：

- `AI_API_KEY`
- `GOOGLE_API_KEY`

后端常用可选：

- `SERVER_ADDRESS`，默认 `:8080`
- `SQLITE_PATH`，默认 `data/streetview.db`
- `RATE_LIMIT_ENABLED`，默认 `true`
- `PROXY_URL` / `AI_PROXY_URL` / `MAPS_PROXY_URL`
- `OPENAI_API_KEY` / `REALTIME_API_KEY`，Atlas Voice 语音功能需要其一
- `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_API_BASE` / `OPENAI_REALTIME_WS_URL` / `OPENAI_REALTIME_VOICE`（默认 `cedar`）/ `OPENAI_REALTIME_TRANSCRIPTION_MODEL`
- `OPENAI_REALTIME_ALLOWED_ORIGINS` / `REALTIME_ALLOWED_ORIGINS`，额外允许的语音 WebSocket 浏览器来源
- `ATLAS_VOICE_PROVIDER`，默认 `openai`；设为 `doubao` 时 OpenAI Realtime 只负责听写、文本回复和工具调用，音频由豆包 TTS 输出
- `DOUBAO_TTS_API_KEY`，或 `DOUBAO_TTS_APP_ID`/`DOUBAO_TTS_APPID` + `DOUBAO_TTS_ACCESS_KEY`/`DOUBAO_TTS_TOKEN`；豆包语音合成凭据
- `DOUBAO_TTS_SPEAKER`（默认 `zh_male_m191_uranus_bigtts`，云舟 2.0 男声）/ `DOUBAO_TTS_RESOURCE_ID`（默认 `seed-tts-2.0`）/ `DOUBAO_TTS_FORMAT`（必须是 `pcm`）/ `DOUBAO_TTS_SAMPLE_RATE` / `DOUBAO_TTS_SPEECH_RATE` / `DOUBAO_TTS_PROXY_URL`
- `SENTRY_DSN` / `SENTRY_ENABLED` / `GO_ENV`

前端必须配置：

- `VITE_GOOGLE_MAPS_API_KEY`

前端常用可选：

- `VITE_GOOGLE_MAPS_MAP_ID`
- `VITE_REALTIME_TRANSPORT`，默认 `backend-ws`
- `VITE_REALTIME_TRANSCRIPTION_MODEL`
- `VITE_REALTIME_VOICE`，默认 `cedar`
- `VITE_REALTIME_OUTPUT_SPEED`，默认 `1`
- `VITE_REALTIME_VAD_TYPE` / `VITE_REALTIME_VAD_EAGERNESS` / `VITE_REALTIME_VAD_THRESHOLD` / `VITE_REALTIME_VAD_PREFIX_PADDING_MS` / `VITE_REALTIME_VAD_SILENCE_DURATION_MS`
- `VITE_ATLAS_VOICE_PROVIDER` / `VITE_REALTIME_AUDIO_PROVIDER`，可选前端覆盖；通常留空，由后端 `/api/v1/realtime/voice-config` 决定
- `VITE_SENTRY_DSN`
- `VITE_VERSION`

## 文档位置

- `README.md` - 面向新人和外部读者的入口。
- `docs/architecture.md` - 当前架构、数据流和状态机。
- `docs/runbook.md` - 安装、冒烟、部署和故障排查。
