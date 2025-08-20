# 前端性能优化 TODO

## 🔴 高优先级

### 1. Bundle体积优化 (当前: ~~125KB~~ 83KB gzip) ✅ 减少 33%
- [ ] 代码分割 - 按路由和组件懒加载
- [ ] 优化依赖导入
  - [ ] lodash 按需导入 (使用 lodash-es 或具体函数)
  - [x] Sentry 延迟加载或条件加载 ✅ (减少 42KB)
  - [ ] 移除未使用的 zustand (如果未使用)
- [ ] 分析并移除未使用代码
- [ ] 配置 webpack 优化

### 2. 首屏加载优化 ✅ 已完成
- [x] Google Maps API 异步加载优化 ✅ (IntersectionObserver + requestIdleCallback)
- [x] 字体加载优化 (font-display: swap) ✅ (非阻塞加载)
- [x] i18next 翻译文件缓存 ✅ (localStorage缓存7天)
- [x] 实现骨架屏 ✅ (SkeletonLoader组件)
- [ ] 关键 CSS 内联

### 3. 缓存策略
- [ ] 配置静态资源长期缓存
- [ ] 实现 Service Worker
- [ ] API 响应缓存
- [ ] localStorage 缓存优化

### 4. 渲染性能 ✅ 已完成
- [x] React.memo 优化组件 ✅ (StreetView, Sidebar, Toast等)
- [x] useMemo/useCallback 优化 ✅ (POV更新、事件处理器)
- [x] 优化重渲染逻辑 ✅ (使用useReducer批量更新)
- [x] 街景自动旋转优化 ✅ (降至30FPS，节省50%CPU)

## 🟡 中优先级

### 5. 资源优化
- [ ] 图片格式优化 (WebP)
- [ ] 预连接优化 (preconnect/prefetch)
- [ ] HTTP/2 推送配置

### 6. 监控与分析
- [ ] 添加性能监控指标
- [ ] Lighthouse CI 集成
- [ ] Bundle 分析报告

## 🟢 低优先级

### 7. 体验优化
- [ ] PWA 支持
- [ ] 离线功能
- [ ] 预加载下一个位置

## 性能目标
- Bundle size: < 80KB (gzip)
- FCP: < 1.5s
- TTI: < 3s
- Lighthouse Score: > 90