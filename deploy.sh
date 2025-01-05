#!/bin/bash

# 停止并删除旧容器
make clean

# 拉取最新代码
git pull

# 加载生产环境变量
set -a
source .env.prod
set +a

# 启动服务
make prod

# 检查服务状态
echo "检查服务状态..."
sleep 10
docker-compose ps

# 检查日志是否有错误
echo "检查错误日志..."
docker-compose logs --tail=50 | grep -i error

# 显示服务访问信息
echo "服务已启动:"
echo "前端: https://你的域名.com"
echo "后端: https://api.你的域名.com"
echo "Redis 密码已保存在日志中" 