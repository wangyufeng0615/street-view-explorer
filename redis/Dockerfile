FROM redis:7.2-alpine

# 安装必要的工具
RUN apk add --no-cache tzdata

# 设置时区
ENV TZ=Asia/Shanghai

# 创建 Redis 数据目录
RUN mkdir -p /data && chown redis:redis /data

# 复制 Redis 配置文件
COPY conf/redis.conf /usr/local/etc/redis/redis.conf

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s \
    CMD redis-cli ping || exit 1

# 暴露端口
EXPOSE 6379

# 使用自定义配置文件启动 Redis
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"] 