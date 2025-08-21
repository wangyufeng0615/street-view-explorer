# 第一阶段：构建前端
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# 从构建参数获取前端路径
ARG FRONTEND_BUILD_CONTEXT=./frontend

# 复制前端代码
COPY ${FRONTEND_BUILD_CONTEXT}/package.json ${FRONTEND_BUILD_CONTEXT}/yarn.lock* ./

# 安装依赖
RUN yarn install --frozen-lockfile --network-timeout 100000

# 复制源代码
COPY ${FRONTEND_BUILD_CONTEXT}/ ./

# 构建应用
RUN yarn build

# 第二阶段：nginx服务器
FROM nginx:alpine

# 创建必要的目录
RUN mkdir -p /usr/share/nginx/html

# 从构建阶段复制前端静态文件
COPY --from=frontend-builder /app/build /usr/share/nginx/html

# 复制nginx配置文件
COPY nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf

# 创建nginx状态页面目录（用于健康检查）
RUN mkdir -p /usr/share/nginx/html/nginx_status

# 健康检查 - 使用wget检查nginx状态
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/nginx_status || exit 1

# 暴露端口
EXPOSE 3000