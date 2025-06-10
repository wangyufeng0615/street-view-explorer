# 构建阶段
FROM node:18-bullseye AS builder

WORKDIR /app

# 更新包管理器并安装必要的网络工具
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# 检查 yarn 版本（node:18-bullseye 自带 yarn）
RUN yarn --version

# 复制 package.json 和 yarn.lock（如果存在）
COPY package.json yarn.lock* ./

# 安装依赖
RUN yarn install --frozen-lockfile --network-timeout 100000

# 复制源代码
COPY . .

# 设置构建参数
ARG REACT_APP_GOOGLE_MAPS_API_KEY
ARG REACT_APP_GOOGLE_MAPS_MAP_ID

# 构建应用
RUN yarn build

# 使用更轻量的镜像来存放静态文件
FROM alpine:3.19

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/build /app/html

# 使容器保持运行
CMD ["sh", "-c", "while true; do sleep 1; done"] 