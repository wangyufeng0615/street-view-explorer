# CLAUDE.md

Street View Explorer - 随机全球街景探索 + AI 描述生成

## 常用命令

```bash
# 前端
cd frontend && yarn dev          # 开发服务器 (port 3000)
cd frontend && yarn build        # 生产构建

# 后端
cd backend && go run cmd/server/main.go    # 启动服务器 (port 8080)
cd backend && go test ./...                 # 运行测试

# 部署
make deploy                      # Docker Compose 部署
```

## 项目结构

```
frontend/src/
├── components/     # UI组件 (StreetView, GlobalMap, Sidebar...)
├── pages/          # 页面 (HomePage.jsx, AgentPage.jsx, LetterPage.jsx)
├── hooks/          # 自定义hooks (useLocationData, useExplorationMode...)
├── store/          # Zustand状态管理 (useStore.js)
├── services/       # API客户端 (api.js)
├── locales/        # i18n 翻译 (en/, zh/)
├── config/         # 应用配置
├── constants/      # 常量
├── utils/          # 工具函数
└── styles/         # CSS样式

backend/
├── cmd/server/     # 入口 main.go
├── internal/api/   # handlers.go, agent_handlers.go, routes.go, middleware.go
├── internal/services/   # location_service, ai_service, maps_service
├── internal/repositories/  # sqliterepo.go (SQLite 数据库 + 限流)
├── internal/openai/ # AI API 客户端
├── internal/models/ # 数据模型
├── internal/sentry/ # Sentry 错误追踪
├── internal/config/ # 配置管理
└── internal/utils/  # 工具函数 (地理算法, 日志, 代理)
```

## 关键技术决策

- **数据库**: SQLite (WAL 模式，纯 Go 实现 modernc.org/sqlite，零外部依赖)
- **限流**: SQLite 表 (rate_limits)，替代 Redis
- **状态管理**: Zustand (frontend/src/store/useStore.js)
- **API响应格式**: `{ success: bool, data: {}, error: string }`

## API 路由

- `GET /api/v1/locations/random` — 获取随机街景位置（基于 sessionID 匹配偏好）
- `GET /api/v1/locations/lookup` — 根据坐标查找位置
- `GET /api/v1/locations/:panoId/description` — 获取 AI 描述
- `GET /api/v1/locations/:panoId/detailed-description` — 获取详细 AI 描述
- `GET /api/v1/visits` — 获取访问历史
- `POST /api/v1/preferences/exploration` — 设置探索偏好
- `POST /api/v1/preferences/exploration/remove` — 删除探索偏好

### 奥德赛 (Agent Journey) — token-based auth

- `POST /api/v1/agent/journeys` — AI 创建旅程
- `GET /api/v1/agent/journeys` — 按 token 查询旅程列表 + 总访问地点数
- `GET /api/v1/agent/journeys/:id` — 获取旅程详情（含 stops）
- `PUT /api/v1/agent/journeys/:id/status` — 更新旅程状态
- `GET /api/v1/agent/journeys/:id/public-letter` — 获取公开来信（无需 token）
- `GET /api/v1/agent/explore` — 在指定坐标附近找街景
- `GET /api/v1/agent/streetview` — 代理 Google Street View 静态图片
- `POST /api/v1/agent/journeys/:id/stops` — 保存一站数据
- `GET /api/v1/agent/journeys/:id/stops` — 获取所有站点
- `POST /api/v1/agent/journeys/:id/letter` — 保存来信

## 环境变量

后端必须配置: `AI_API_KEY`, `GOOGLE_API_KEY`
后端可选配置: `SQLITE_PATH` (默认 `data/streetview.db`), `SERVER_ADDRESS` (默认 `:8080`)
前端必须配置: `VITE_GOOGLE_MAPS_API_KEY`

## 奥德赛功能 (/agent)

用户在页面上选出发地 → 复制 Skills 给自己的 AI → AI 自主探索街景、拍照、写图文来信。

- **前端路由**: `/agent`（lazy loaded），入口在 TopBar 更多菜单
- **AI 身份**: Traveler ID（7 位 hex），AI 自己生成并存入 `memory_with_atlas.md`
- **记忆机制**: `memory_with_atlas.md` 结构化文件，含身份、旅程记录（100 条）、感悟（重写式）、未完线索
- **来信**: 服务端存完整图文（街景 URL），本地存同内容但图片下载为 `atlas-photos/`
- **安全**: 街景代理 pano_id 正则校验 + 数值参数校验；双层限流（per-token + per-IP）
- **数据库表**: `agent_journeys`（旅程）、`agent_journey_stops`（站点 + photo_heading）

## 注意事项

- SQLite 数据库文件自动创建，schema 自动迁移（sqliterepo.go 中的 migrate 方法）
- Docker 部署时数据库文件挂载在 `sqlite_data` volume 中
- 开发环境数据库默认在 `backend/data/streetview.db`
