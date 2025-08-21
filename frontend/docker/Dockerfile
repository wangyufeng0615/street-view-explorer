# 构建阶段 - 使用更轻量的Alpine镜像
FROM node:18-alpine AS builder

WORKDIR /app

# 复制 package.json 和 yarn.lock（如果存在）
COPY package.json yarn.lock* ./

# 安装依赖
RUN yarn install --frozen-lockfile --network-timeout 100000

# 复制源代码
COPY . .

# 构建应用
RUN yarn build

# 注意：构建产物将被nginx Dockerfile直接COPY，这里不需要运行时阶段