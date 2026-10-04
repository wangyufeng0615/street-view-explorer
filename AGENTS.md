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
make clean # 停止容器，保留 SQLite 数据

# 统一本地/CI 检查
make check
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
├── components/     # StreetView, GlobalMap, PreviewMap, AtlasVoicePanel, GameFeedback 等；home/ 是首页组件（导航、小地图、Atlas 来信、底部操作栏、加载遮罩）
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
- 字体只用 `index.css` 里的三个变量：`--font-sans`（英文系统字体，中文回退苹方/冬青黑体/微软雅黑/思源黑体）、`--font-serif`（Noto Serif SC，退到系统宋体和 Georgia）、`--font-mono`；不要在组件里另写字体栈。Noto Serif SC 由用到衬线体的页面调用 `loadNotoSerifSC()` 按需加载，只取 400/600 两档（更粗的标题落到 600）；首页等第一张全景出来（最多 3 秒）再加载，不和街景图块抢带宽。`index.html` 只做预连接，不再全局加载任何字体；表单控件统一 `font-family: inherit`。`<html lang>` 跟随界面语言（`zh-CN` / `en`），浏览器据此挑选中文字形。
- 前端 ESLint 启用 `react-hooks` 规则，`exhaustive-deps` 是 error；有意省略依赖时用 `// eslint-disable-next-line react-hooks/exhaustive-deps -- 原因`。新增依赖前先确认它不会让 effect 多跑。

## UI 路由

- `/` - 随机街景探索首页。
- `/footprints` - Atlas 足迹地图。从首页打开时是背景路由浮层，首页保持挂载、街景暂停；直接访问只渲染 `FootprintPage`，不跑首页。
- `/agent` - Odyssey，给外部 AI 复制旅行 skill 和旅程入口。
- `/agent/letter/:id` - 公开旅程来信。
- `/guess` - 单人卫星图猜地理。
- `/guess/online` - 在线 1v1 对战大厅。
- `/guess/online/:roomId` - 在线对战房间。
- `/geo`、`/geo/online`、`/geo/online/:roomId` - 旧路由，前端重定向到对应 `/guess` 路由。

## API 路由

### 基础探索

- `GET /api/v1/locations/random` - 随机街景位置，支持 `lang` 和 `source`。`prefetch=1` 是首页预取下一站：照常存位置但不写足迹，服务端内存记下"本会话预取过的全景"（15 分钟、每会话最多 2 个）。
- `POST /api/v1/locations/:panoId/visit` - 预取的地点真正展示时补写 random 足迹；只接受本会话预取过且未过期的全景，一次性，否则 404。
- `GET /api/v1/locations/lookup` - 根据坐标反查位置。
- `GET /api/v1/locations/address` - 只返回坐标在指定 `lang` 下的地址字段；切换界面语言时更新当前地点名，不换全景、不记访问，每 IP 每分钟 30 次。
- `GET /api/v1/locations/search` - 通过 Google Places/Geocoding 搜索具体地点或地标，并跳到附近街景。
- `GET /api/v1/locations/:panoId/description` - AI 简短描述。
- `GET /api/v1/locations/:panoId/detailed-description` - AI 详细描述。
- `GET /api/v1/visits` - 全站共享的 Atlas 足迹历史；写入仍保留 session 作为账本字段，读取不按用户过滤。`fields=map` 只返回 pano_id/latitude/longitude/formatted_address，足迹页使用；默认返回完整字段。
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
- `GET /api/v1/realtime/client-secret` - 为 WebRTC 路径创建 OpenAI Realtime 临时 session；默认关闭（404），需 `REALTIME_WEBRTC_ENABLED=true`。
- `POST /api/v1/realtime/calls` - 代理 WebRTC SDP 到 OpenAI Realtime；同样受 `REALTIME_WEBRTC_ENABLED` 控制。
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
- `GET /api/v1/geo/satellite` 可带 `width,height`，两者必须同时提供且每边在 120-640；单人和 AI 猜测会按当前卫星面板比例请求图片，缺省仍是 640x480。卫星图用 `format=jpg`（比 PNG 小 3-6 倍）；AI 猜测给图画准星后重新编码为 PNG，避免 JPEG 色度下采样把红色准星冲淡。
- `generateRoundPlan()` 会从 `geoDatabase.js` 选 2 或 3 个题库点，其余使用后端随机位置；题库点会经过 `jitterCoord()` 小偏移。
- `useGeoGameRoundTargets` 的 loading effect 使用 `langRef` 读取语言，避免语言切换重新抽题。
- 单人卫星图中心图钉必须始终可见；拉远时先加载下一张静态图，再用约 760ms 的 handoff 动画切换，避免闪烁。
- 简单音效和气泡提示通过 `useGameFeedback()` / `GameFeedback.jsx` 复用，单人模式的本地开关 key 是 `geoGameSound`。
- 计分公式在前后端一致：`5000 * exp(-zoomSteps * 0.12) * exp(-effectiveDistanceKm / 1500)`；`effectiveDistanceKm = max(0, distanceKm - min(100, 1 * 1.45^zoomSteps))`，拉远后容错半径会动态变大。
- Atlas AI 猜测只看到用户锁定结果时当前 zoom 的一张卫星图，不会看到前面每次拉远的历史图；prompt 明确要求猜这张图的中心点，并按 UI 语言返回 reasoning。
- Atlas 每轮结果页只猜一次：之后切换语言或调整卫星面板尺寸不会重新请求，reasoning 保持请求时的语言；被中止的请求不上报失败。
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
- 揭晓阶段结果地图按 `getBattleResultOverlayKey()`（阶段、轮次、目标、双方猜测坐标）重绘，轮询带来的新 room 对象不会重画或重新取景。
- 多人卫星图也必须显示中心图钉，并和单人模式使用一致的拉远 handoff 动画；加载新图时保留旧图，禁用地图交互避免误点。
- 多人颜色语义：红色是你，蓝色是对手，绿色是正确位置；这些颜色要在玩家卡片、地图图钉、气泡和结果文字里保持一致。
- 多人结果必须清晰展示拉远次数、时间剩余或不扣分状态、距离，以及 base/zoom/tolerance/distance/final 等计分权重。
- 多人音效和气泡提示也走 `useGameFeedback()` / `GameFeedback.jsx`，本地开关 key 是 `geoBattleSound`。
- 双人对战计分和单人局一致，也使用随拉远次数增长的动态容错半径；跳过或超时本轮为 0 分。
- finished 或 lobby 阶段离开会移除玩家；playing 等中途离开会直接结束房间。

## 首页实现要点

- 封面：首次进入（地址没有坐标、本标签页没看过，`sessionStorage.atlasCoverSeen`）先叠一层 `CoverOverlay`：从 `data/coverPlaces.js` 的 30 个地点随机挑一张满屏卫星图，只有标题和“跟 Atlas 出发”按钮，四角是细框、坐标和影像出处（Sentinel-2 cloudless 2016 © EOX，CC BY 4.0，必须保留）。不会自动走，按钮、空格或回车出发，Esc 直接收起，封面淡出后露出街景。第一站照常在底下加载，封面开着时街景暂停、不预取；决定显示的同时就开始下载这张图。图片在 `frontend/public/cover/<id>.webp`（2048px 宽，单张约 400KB 以内），用 `scripts/build_cover_images.py` 重建，重建后递增 `utils/coverGate.js` 的 `COVER_IMAGE_VERSION`；手机竖屏的取景位置写在地点的 `posMobile`。
- 布局：街景占右侧栏以外的区域，左上 `HomeNav`，底部居中 `HomeDock`（旅程、去哪儿、下一站、语音）。右侧栏 `home-side` 整栏是纸面（`--home-paper`）：上方两张小地图并排（`HomeMiniMap`，世界/附近，点开后放大面板浮在街景上），下方 `AtlasLetter` 以衬线粗体地名为标题、常驻显示 Atlas 全文和出处，不需要展开。左上角标题是 `site_tagline`（"和 Atlas 一起探索地球"）。底部按钮都带文字：旅程（带站数）、目的地当前选项（"随机目的地"或兴趣词）、"下一站"（只有文字和"空格"键帽，不加箭头）、语音。"下一站去哪儿"面板是两个同样形状的选项（随机 / 指定地方或主题，后者内含输入框），当前生效的一项有底色和对勾；输入框只在有鼠标键盘的设备上自动聚焦。导航和底部操作栏用容器查询按自身可用宽度收紧：导航放不下就把链接收进菜单（中文约 560px、英文约 700px），操作栏窄于 580px 时次要按钮只留文字、隐藏站数和键帽。手机上街景在上（52vh），地图和来信在下，操作栏贴着街景底边。
- 视觉：街景上的导航和操作栏用 `home-bare`，不加底板，靠 `.home-stage::after` 的上下暗角和文字阴影保证可读；弹出菜单、放大地图用不透明的 `home-panel`，不做毛玻璃。中性色都偏暖（象牙白文字、暖棕黑），"下一站"是唯一的象牙色实心按钮；琥珀色 `--home-accent` 只用在当前页下划线、当前站圆点、语音波纹。衬线字体只用于 Atlas（品牌字和来信），中文不用斜体（浏览器只会硬拧歪字形）。`animations.css` 只剩足迹页和提示用的几个关键帧，不再有全局 `input:focus` / `button:hover` 样式。
- 出发到街景首次报告视角之间用 `ArrivalOverlay` 遮住街景区域，最多 8 秒，街景报错（`StreetView` 的 `onLoadError`）时立即撤掉，让街景自己的错误说明露出来；只显示出发提示、不显示地址（地名在右侧来信里），并延迟 0.3 秒才淡入，预取命中时不会一闪而过；`streetViewView` 在加载新位置时会被清空，用它判断是否落地。
- 本次旅程存在 `sessionStorage` 的 `atlasJourney`，最多 30 站；回到旧站直接用记下的全景和地址（`applyNavigatedLocation`），不按坐标重新查找、不多记足迹，旅程顺序也不变。地图选点或语音导航落到当前全景时什么都不做，不清空讲解。
- 街景"可以手动旋转"的操作提示每次打开网页只弹一次（`StreetView` 模块级标记），换站不再重复。
- 地名显示经过 `formatAddress`：去掉 Google 给无名道路加的 "Unnamed Road" 前缀，只剩它时退回城市和国家；逗号分段地址里第一段以外的纯数字邮编会去掉；Google 中文地址把国家名直接接在拉丁字母后面时补上逗号。
- 地点名跟着界面语言：store 给每个位置标 `address_language`，与界面语言不一致时 `relocalizeLocationAddress` 只重取地址字段。后端随机选点的"已验证全景兜底"会先按请求语言重新反查地址（最多 1.5 秒，失败保留原地址）。
- 只显示 Google 官方街景：用户上传的全景图片走 `lh3.googleusercontent.com`，共享代理 IP 常被限流返回 429 导致黑屏。后端随机选点用 metadata 的 `copyright` 含 "Google" 过滤，已验证全景兜底按 ID 长度（官方 22 位）跳过用户全景；前端 `StreetView` 拿到官方 `panoId` 直接 `setPano`，否则用 `StreetViewService.getPanorama({ sources: [GOOGLE], preference: NEAREST })` 在 5 km 内找最近的官方全景，找不到就显示暂无街景，不退回用户全景。
- 取位置失败不再整页报错：`ArrivalOverlay` 显示错误卡片，提供重试；兴趣模式下还提供"改为随机出发"。后端错误文案只有中文，前端不直接展示：`api.js` 返回 `status`（网络失败为 0 并给出界面语言的超时/断网提示），store 按状态码换成 `error.*` 文案，原文只进控制台。兴趣偏好接口例外，它在 200 响应里按 `lang` 返回已本地化的原因（太短/太长/无法理解），上限 50 个字符（按字符计，前端输入框同样限制）。
- Google 地图标志和版权行（含街景右下角）按使用条款不能隐藏或遮挡：不要再往页面里注入隐藏 `.gm-style-cc` 的样式；小地图的放大角标在右上角，手机上底部操作栏离街景底边留 32px。
- 地图中继试验已于 2026-10-03 下线；`utils/retiredServiceWorkers.js` 在启动时注销它在浏览器里留下的整站 Service Worker。
- 小地图等第一张全景出来（最多 3 秒）再加载，之后换位置时保留地图只移动位置。放大面板看过的地图收起后只隐藏、不销毁（每新建一张 Google 地图都算一次计费加载）；放大面板只响应点击出发，拖动只是挪地图，支持缩放。Maps 脚本不再带 `libraries=marker`，需要标记的地图先调用 `loadMarkerLibrary()`。
- 底部操作栏：语音面板（`AtlasVoicePanel`，含实时连接和音频）在浏览器空闲时才加载，之前显示外观相同的禁用占位按钮；空闲时不订阅朝向等字段。连接中可以取消，主动停止会收起回复记录，语音结束后残留的提示 8 秒后收起。忙碌（加载位置、保存偏好、地图选点）时"下一站"和空格都不可用，按住空格的自动重复不触发。721–900px 宽时操作栏只留文字。
- 来信只在点"再多讲讲"时读取当前视角（`getView`），拖动街景不会重渲染讲解；讲解流式追加期间 `aria-busy` 为真。

## Atlas Voice 实现要点

- 前端入口是 `frontend/src/components/AtlasVoicePanel.jsx`，只挂在首页；运行时工具和 VAD 配置在 `frontend/src/utils/atlasVoiceRuntime.js`，共享 persona 在 `frontend/src/utils/atlasPersona.js` 和 `backend/internal/atlas/persona.go`。
- 默认传输是 `VITE_REALTIME_TRANSPORT=backend-ws`：浏览器连同源 `/api/v1/realtime/ws`，后端再连 OpenAI Realtime。WebRTC 兼容路径会先拿 `/client-secret`，再走 `/calls`，后端默认关闭，启用时前后端要同时配置。
- `/ws` 中继只放行前端实际发送的客户端事件（`realtime_client_events.go` 白名单）：`session.update` 只保留允许字段、三个 Atlas 工具和截断后的 instructions。前端新增事件类型或工具时必须同步更新白名单，否则会被静默丢弃。空闲 90 秒按两个方向共享计时。
- 默认 Realtime 模型是 `gpt-realtime-2.1`，输出音色 `cedar`，转写模型 `gpt-4o-mini-transcribe`，turn detection 是 `semantic_vad` + `high`，支持被用户打断。
- 工具集合在 `frontend/src/utils/atlasVoiceTools.js`：`navigate`（random/theme/place/coordinates/nearby）、`look_direction`、`read_current_place`。每个用户回合只允许一次导航尝试；具体地标/地址/店名走 `navigate` 的 place 模式，调用 `GET /api/v1/locations/search`。
- `ATLAS_VOICE_PROVIDER=doubao` 时 OpenAI Realtime 只负责听写、文本、记忆和工具调用，后端 `/doubao-tts` 负责把最终文本转成 PCM 流。前端会排队播放并用短窗口忽略豆包外放回灌。
- 后端 Realtime WebSocket origin 校验允许同源、本地 `localhost/127.0.0.1/::1`，生产额外域名用 `OPENAI_REALTIME_ALLOWED_ORIGINS` / `REALTIME_ALLOWED_ORIGINS`。

## 安全与日志注意

- `make clean` 保留数据卷；只有显式 `make destroy-data CONFIRM_DELETE_DATA=yes` 才删除当前 Compose 项目的数据卷，执行前必须备份。

- `RateLimitMiddleware()` 默认开启；`/api/v1/locations/search` 是每 IP 每分钟 45 次；`/api/v1/geo/ai-guess` 是每 IP 每分钟 30 次；`/api/v1/geo/satellite` 和 `/api/v1/geo/online/rooms/:roomId/image` 是每 IP 每分钟 180 次；Realtime session / WebSocket / Doubao TTS 入口是每 IP 每分钟 20 次，`/api/v1/realtime/voice-config` 是 120 次；在线对战建房、加入、ready 和 `POST /matchmaking` 是每 IP 每分钟 20 次（每次开局会生成 5 轮题目并调用大量 Google 接口）；`/api/v1/locations/lookup` 和 `/address` 每次都要反查地址，是每 IP 每分钟 30 次。AI 描述全局小时预算另有每 IP 四分之一份额，上游失败会退还。
- 限流表 `expires_at` 统一写成 UTC 定宽字符串（`rateLimitTime`），不要直接绑定 `time.Time`；启动迁移会清掉旧格式行。
- Google Static Maps 请求失败日志会隐藏 `GOOGLE_API_KEY`；不要把旧本地日志或生产日志原样外发，尤其是 2026-05-03 之前生成的地图错误日志。
- `[ERROR]` 日志会附带脱敏后的底层原因（`AppError` 取 `InternalMsg`），排查上游失败时直接看 `error=` 字段。
- Atlas 讲解时反向地理编码失败会退回点位已保存的地址继续讲；街景画面取不到仍然直接失败，因为讲解必须基于真实画面。
- 普通讲解整段语言不对（闸门没放出任何文字）且第一次在 12 秒内失败时，后端原地再请求一次，访客只多等一会儿；"再多讲讲"不重试。兴趣偏好接口只有模型给不出区域时才提示"无法理解"，AI 服务故障按普通错误上报。
- 讲解请求在真正调用 AI 之前就被取消（用户切站，包括画面已就绪但还没发出 AI 请求）时退还小时预算，客户端主动断开不按后端错误上报；讲解前取场景图最多 6 秒、反查地址最多 1.5 秒；上游返回的 `Retry-After` 最多等 2 秒。随机选点的反查地址最多并发 2 个，被降权的候选晚 0.5 秒才反查，避免一次随机花掉多次地理编码。
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
- `REALTIME_WEBRTC_ENABLED`，默认 `false`；只在前端 `VITE_REALTIME_TRANSPORT=webrtc` 时开启
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

## 可靠性修复（2026-09-05）

- 实际生产入口是 SG `/opt/street-view-explorer`，部署用 `make deploy-remote REMOTE_HOST=sg REMOTE_DIR=/opt/street-view-explorer REMOTE_BRANCH=main REMOTE_SUDO=1`；使用前核对运行状态，不沿用 KR 默认值。
- SQLite 连接参数使用 modernc `_pragma`；限流提交失败必须返回错误并清理连接上的事务。
- `TRUSTED_PROXY_CIDRS` 只填写真实代理跳的 CIDR，空值不信任转发头。
- 来信正文不缓存。`research_status` 区分上游确认过搜索的 `verified` 和没有执行证据的 `unverified`；后者在 UI 明示，不能根据 tool_choice 推断已执行。
- 足迹 `distinct=1` 按 panorama 分页，展示加载数量和全站总数；低缩放级别聚合图钉。
- WebSocket、备题预算、备份和回滚流程以 `docs/runbook.md` 为准。
