# 前端加载速度深度优化方案

## 📊 当前性能分析

### Bundle 大小分析
- 主包: 85.2 kB (gzipped) - 较为合理
- Sentry chunk: 124.76 kB - 偏大，已做懒加载
- CSS: 3.58 kB - 很小，良好

### 已有优化
✅ DNS prefetch 和 preconnect
✅ 字体异步加载 (font-display: swap)
✅ Sentry 懒加载
✅ React.memo 和 useCallback 优化

## 🚀 深度优化建议

### 1. **首屏渲染优化 (最高优先级)**

#### 1.1 实现骨架屏预渲染
```javascript
// 在 index.html 中内联骨架屏 CSS 和 HTML
// 这样用户立即看到界面轮廓，体感加载速度提升 50%+
<style>
  .skeleton-street-view {
    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: loading 1.5s infinite;
  }
</style>
```

#### 1.2 关键路径 CSS 内联
```javascript
// 使用 critters 或 critical 提取关键 CSS
// 将首屏需要的 CSS 内联到 HTML，其余异步加载
npm install --save-dev critters-webpack-plugin
```

### 2. **Google Maps 加载策略优化**

#### 2.1 实施三阶段加载
```javascript
// Phase 1: 仅加载 StreetView (用户最关心的)
// Phase 2: 延迟 500ms 加载 PreviewMap
// Phase 3: 用户交互时才加载 GlobalMap

const loadMapsPhased = () => {
  // 优先加载街景
  loadStreetView().then(() => {
    // 街景加载完成后，延迟加载预览地图
    setTimeout(() => loadPreviewMap(), 500);
    
    // 全局地图按需加载
    onUserInteraction(() => loadGlobalMap());
  });
};
```

#### 2.2 使用 Google Maps Lite Mode
```javascript
// 对于预览地图，使用静态地图 API 替代动态地图
// 减少 80% 的加载时间
const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?
  center=${lat},${lng}&zoom=3&size=300x200&key=${API_KEY}`;
```

### 3. **代码分割深度优化**

#### 3.1 路由级懒加载 (虽然是单页应用，但可以分割功能模块)
```javascript
// 将设置、帮助等非核心功能懒加载
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const HelpContent = lazy(() => import('./components/HelpContent'));
```

#### 3.2 移除未使用的 lodash
```javascript
// 当前引入了完整的 lodash (70KB+)
// 改为按需引入或使用原生方法
import debounce from 'lodash/debounce'; // ❌ 仍会打包整个库
import debounce from 'lodash-es/debounce'; // ✅ 仅打包需要的函数
```

### 4. **运行时性能优化**

#### 4.1 实现虚拟滚动
```javascript
// 如果有列表展示，使用 react-window 或 react-virtualized
// 减少 DOM 节点，提升滚动性能
```

#### 4.2 Web Worker 处理地理计算
```javascript
// 将复杂的地理计算移到 Web Worker
// 避免阻塞主线程
const geoWorker = new Worker('./geo.worker.js');
geoWorker.postMessage({ type: 'calculateArea', data: polygon });
```

### 5. **网络优化**

#### 5.1 实现智能预加载
```javascript
// 预测用户下一个可能访问的位置并预加载
const prefetchNextLocation = async () => {
  // 在用户停留超过 3 秒时，预加载下一个位置
  const nextLocation = await api.getRandomLocation();
  // 预加载街景图片
  new Image().src = getStreetViewUrl(nextLocation);
};
```

#### 5.2 使用 Service Worker 缓存策略
```javascript
// 缓存静态资源和 API 响应
self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/locations/')) {
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request).then(res => {
          const clone = res.clone();
          caches.open('api-cache').then(cache => {
            cache.put(event.request, clone);
          });
          return res;
        });
      })
    );
  }
});
```

### 6. **图片和资源优化**

#### 6.1 使用 WebP 格式
```javascript
// 检测 WebP 支持并提供相应格式
const supportsWebP = () => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  return canvas.toDataURL('image/webp').indexOf('image/webp') === 0;
};
```

#### 6.2 实现渐进式图片加载
```javascript
// 先加载低质量占位图，再加载高质量图片
const ProgressiveImage = ({ lowQualitySrc, highQualitySrc }) => {
  const [src, setSrc] = useState(lowQualitySrc);
  
  useEffect(() => {
    const img = new Image();
    img.src = highQualitySrc;
    img.onload = () => setSrc(highQualitySrc);
  }, []);
  
  return <img src={src} style={{ filter: src === lowQualitySrc ? 'blur(5px)' : 'none' }} />;
};
```

### 7. **构建优化**

#### 7.1 升级到 Vite
```javascript
// Create React App → Vite 迁移
// 开发环境启动速度提升 10 倍
// 生产构建速度提升 2-3 倍
npm create vite@latest my-app -- --template react
```

#### 7.2 启用 Tree Shaking 和 模块联邦
```javascript
// webpack.config.js
optimization: {
  usedExports: true,
  sideEffects: false,
  splitChunks: {
    chunks: 'all',
    cacheGroups: {
      vendor: {
        test: /[\\/]node_modules[\\/]/,
        name: 'vendor',
        priority: 10
      },
      common: {
        minChunks: 2,
        priority: 5,
        reuseExistingChunk: true
      }
    }
  }
}
```

### 8. **监控和度量**

#### 8.1 实现 Real User Monitoring (RUM)
```javascript
// 监控真实用户的加载性能
const reportMetrics = () => {
  const perfData = window.performance.timing;
  const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
  const ttfb = perfData.responseStart - perfData.navigationStart;
  
  // 发送到分析服务
  analytics.track('Performance', {
    pageLoadTime,
    ttfb,
    ...window.performance.getEntriesByType('navigation')[0]
  });
};
```

#### 8.2 设置性能预算
```javascript
// package.json
"bundlesize": [
  {
    "path": "./build/static/js/main.*.js",
    "maxSize": "100 kB"
  },
  {
    "path": "./build/static/css/main.*.css",
    "maxSize": "10 kB"
  }
]
```

## 🎯 快速实施计划

### Phase 1 (立即实施，1-2天)
1. ✅ 移除未使用的 lodash，改用原生方法
2. ✅ 实现骨架屏
3. ✅ Google Maps 分阶段加载

### Phase 2 (短期，1周)
1. ⏳ 迁移到 Vite
2. ⏳ 实现 Service Worker 缓存
3. ⏳ 优化图片加载策略

### Phase 3 (中期，2-3周)
1. ⏳ Web Worker 处理复杂计算
2. ⏳ 实现智能预加载
3. ⏳ 添加性能监控

## 📈 预期效果

通过实施以上优化：
- **首屏加载时间**: 预计减少 40-50%
- **Time to Interactive**: 预计减少 30-40%
- **Lighthouse 分数**: 预计提升到 90+
- **用户体感**: 显著提升，特别是在弱网环境下

## 🔧 具体实施示例

### 示例1: 立即优化 lodash
```bash
# 1. 检查 lodash 使用情况
grep -r "from 'lodash'" src/

# 2. 替换为原生实现或 lodash-es
npm uninstall lodash
npm install lodash-es

# 3. 更新导入
# Before: import _ from 'lodash'
# After: import { debounce, throttle } from 'lodash-es'
```

### 示例2: 实现骨架屏
```javascript
// public/index.html
<div id="root">
  <div class="skeleton-container">
    <div class="skeleton-header"></div>
    <div class="skeleton-street-view"></div>
    <div class="skeleton-sidebar"></div>
  </div>
</div>

// src/index.tsx
ReactDOM.render(<App />, document.getElementById('root'), () => {
  // 移除骨架屏
  document.querySelector('.skeleton-container')?.remove();
});
```

### 示例3: Google Maps 优化加载
```javascript
// src/utils/googleMapsOptimized.js
export const loadGoogleMapsProgressive = async () => {
  // Step 1: 仅加载核心库
  await loadScript(`https://maps.googleapis.com/maps/api/js?key=${KEY}&libraries=places`);
  
  // Step 2: 延迟加载街景
  requestIdleCallback(() => {
    loadScript(`https://maps.googleapis.com/maps/api/js?key=${KEY}&libraries=streetview`);
  });
  
  // Step 3: 按需加载其他功能
  if (userWantsDrawing) {
    await loadScript(`https://maps.googleapis.com/maps/api/js?key=${KEY}&libraries=drawing`);
  }
};
```

## 💡 特别推荐

### 最具性价比的三个优化：
1. **骨架屏** - 实施简单，效果明显
2. **Google Maps 分阶段加载** - 直接减少首屏阻塞时间
3. **移除 lodash 全量引入** - 立即减少 70KB+ 体积

这些优化可以在不改变架构的情况下，显著提升加载性能！