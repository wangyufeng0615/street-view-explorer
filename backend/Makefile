.PHONY: docker-redis-start
docker-redis-start:
	@echo "启动 Redis Docker 容器..."
	@docker-compose up -d redis
	@echo "等待 Redis 就绪..."
	@sleep 3

.PHONY: docker-redis-stop
docker-redis-stop:
	@echo "停止 Redis Docker 容器..."
	@docker-compose down

.PHONY: docker-redis-logs
docker-redis-logs:
	@docker-compose logs -f redis

.PHONY: docker-redis-clean
docker-redis-clean:
	@echo "清理 Redis 数据..."
	@docker-compose down -v

.PHONY: init-redis
init-redis:
	@echo "初始化 Redis 数据..."
	@go run scripts/init_redis.go

.PHONY: clean-exploration-preferences
clean-exploration-preferences:
	@echo "清空探索兴趣缓存..."
	@redis-cli KEYS "exploration_preference:*" | xargs -r redis-cli DEL

.PHONY: dev-setup
dev-setup: docker-redis-start init-redis
	@echo "开发环境设置完成"