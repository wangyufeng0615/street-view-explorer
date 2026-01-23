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
├── pages/          # 页面 (HomePage.jsx 是主入口)
├── hooks/          # 自定义hooks (useLocationData, useExplorationMode...)
├── store/          # Zustand状态管理 (useStore.js)
├── services/       # API客户端 (api.js)
└── styles/         # CSS样式

backend/
├── cmd/server/     # 入口 main.go
├── internal/api/   # handlers.go, routes.go, middleware.go
├── internal/services/   # location_service, ai_service, maps_service
├── internal/repositories/  # sqliterepo.go (SQLite 数据库 + 限流)
└── internal/openai/ # AI API 客户端
```

## 关键技术决策

- **数据库**: SQLite (WAL 模式，纯 Go 实现 modernc.org/sqlite，零外部依赖)
- **限流**: SQLite 表 (rate_limits)，替代 Redis
- **状态管理**: Zustand (frontend/src/store/useStore.js)
- **API响应格式**: `{ success: bool, data: {}, error: string }`

## API 路由

- `GET /api/v1/locations/random` — 获取随机街景位置（基于 sessionID 匹配偏好）
- `GET /api/v1/locations/:panoId/description` — 获取 AI 描述
- `GET /api/v1/locations/:panoId/detailed-description` — 获取详细 AI 描述
- `POST /api/v1/preferences/exploration` — 设置探索偏好
- `POST /api/v1/preferences/exploration/remove` — 删除探索偏好

## 环境变量

后端必须配置: `AI_API_KEY`, `GOOGLE_API_KEY`
后端可选配置: `SQLITE_PATH` (默认 `data/streetview.db`), `SERVER_ADDRESS` (默认 `:8080`)
前端必须配置: `VITE_GOOGLE_MAPS_API_KEY`

## 注意事项

- SQLite 数据库文件自动创建，schema 自动迁移（sqliterepo.go 中的 migrate 方法）
- Docker 部署时数据库文件挂载在 `sqlite_data` volume 中
- 开发环境数据库默认在 `backend/data/streetview.db`
