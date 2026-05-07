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
├── components/     # StreetView, GlobalMap, PreviewMap, Sidebar, TopBar 等
├── pages/          # HomePage, AgentPage, LetterPage, GeoGamePage, GeoBattlePage
├── hooks/          # useLocationData, useExplorationMode, useKeyboardNavigation 等
├── store/          # Zustand 状态管理
├── services/       # api.js，同源 /api/v1 包装
├── locales/        # en/zh 翻译
├── data/           # geoDatabase.js，单人猜地理题库
├── utils/          # googleMaps, session, geoGameUtils, addressUtils
└── styles/         # 页面 CSS

backend/
├── cmd/server/        # main.go
├── internal/api/      # routes.go, handlers, middleware, geo online handlers
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
- Vite 构建输出目录是 `frontend/build`，Nginx Dockerfile 会复制这个目录。
- `frontend/src/services/api.js` 当前使用同源 `/api/v1`，`VITE_API_BASE_URL` 是历史配置字段，不要假设它会改变请求根路径。
- `CORSMiddleware()` 存在但 `main.go` 当前没有注册；部署态 CORS 主要由 `nginx/conf.d/default.conf` 处理。

## UI 路由

- `/` - 随机街景探索首页。
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
- `generateRoundPlan()` 会从 `geoDatabase.js` 选 2 或 3 个题库点，其余使用后端随机位置；题库点会经过 `jitterCoord()` 小偏移。
- `GeoGamePage.jsx` 的 loading effect 使用 `langRef` 读取语言，避免语言切换重新抽题。
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
- `GET /image` 根据当前玩家 zoom 返回同一目标卫星图；reveal/finished 阶段最多展示 zoom 5。
- 双人对战计分和单人局一致，也使用随拉远次数增长的动态容错半径；跳过或超时本轮为 0 分。
- finished 或 lobby 阶段离开会移除玩家；playing 等中途离开会直接结束房间。

## 安全与日志注意

- `RateLimitMiddleware()` 默认开启；`/api/v1/geo/ai-guess` 是每 IP 每分钟 30 次，`/api/v1/geo/satellite` 和 `/api/v1/geo/online/rooms/:roomId/image` 是每 IP 每分钟 180 次。
- Google Static Maps 请求失败日志会隐藏 `GOOGLE_API_KEY`；不要把旧本地日志或生产日志原样外发，尤其是 2026-05-03 之前生成的地图错误日志。
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
- `SENTRY_DSN` / `SENTRY_ENABLED` / `GO_ENV`

前端必须配置：

- `VITE_GOOGLE_MAPS_API_KEY`

前端常用可选：

- `VITE_GOOGLE_MAPS_MAP_ID`
- `VITE_SENTRY_DSN`
- `VITE_VERSION`

## 文档位置

- `README.md` - 面向新人和外部读者的入口。
- `docs/architecture.md` - 当前架构、数据流和状态机。
- `docs/runbook.md` - 安装、冒烟、部署和故障排查。
