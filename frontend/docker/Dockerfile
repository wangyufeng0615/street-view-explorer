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

# 验证并配置 yarn（Node.js 18 已自带 yarn）
RUN yarn --version && \
    yarn config set network-timeout 600000 && \
    yarn config set registry https://registry.npmmirror.com && \
    yarn config set network-concurrency 1 && \
    yarn config set child-concurrency 1

# 复制 package.json 和 yarn.lock（如果存在）
COPY package.json yarn.lock* ./

# 测试网络连通性（检查 Yarn 仓库可访问性）
RUN echo "Testing network connectivity to Yarn registry..." && \
    curl -f --connect-timeout 10 --max-time 30 https://registry.npmmirror.com/ && \
    echo "Network connectivity test passed!"

# 安装依赖（使用更保守的网络设置）
RUN yarn install --frozen-lockfile --network-timeout 600000 --verbose

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