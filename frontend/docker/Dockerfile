# 构建阶段
FROM node:18-alpine AS builder

WORKDIR /app

# 安装 yarn
RUN apk add --no-cache yarn

# 复制 package.json 和 yarn.lock（如果存在）
COPY package.json yarn.lock* ./

# 安装依赖
RUN yarn install --frozen-lockfile

# 复制源代码
COPY . .

# 设置构建参数
ARG REACT_APP_GOOGLE_MAPS_API_KEY
ARG REACT_APP_GOOGLE_MAPS_MAP_ID

# 构建应用
RUN yarn build

# 使用更轻量的镜像来存放静态文件
FROM busybox:1.36

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/build /app/html

# 使用 tail -f /dev/null 来保持容器运行
CMD ["tail", "-f", "/dev/null"] 