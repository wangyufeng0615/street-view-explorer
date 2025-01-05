FROM nginx:alpine

# 安装必要的工具
RUN apk add --no-cache wget curl

# 创建必要的目录
RUN mkdir -p /usr/share/nginx/html

# 复制配置文件
COPY conf.d/default.conf /etc/nginx/conf.d/default.conf

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -q -O /dev/null http://localhost:3000/ || exit 1

# 暴露端口
EXPOSE 3000 