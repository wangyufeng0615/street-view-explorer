.PHONY: deploy clean logs backend-sh frontend-sh frontend-logs redis-logs nginx-logs dev-start dev-stop backend-dev frontend-dev

# 部署命令
deploy:
	@echo "正在构建和部署服务..."
	docker compose build --progress=plain
	@echo "构建完成，启动服务..."
	docker compose up -d
	@echo "检查服务状态..."
	docker compose ps
	@echo "部署完成！"

# 交互式部署（用于调试）
deploy-interactive:
	@echo "交互式部署，可以看到实时日志..."
	docker compose up --build --progress=plain

# 强制重新构建部署
deploy-force:
	@echo "强制重新构建所有服务..."
	docker compose build --no-cache --progress=plain
	docker compose up -d
	docker compose ps

# 安全部署（带错误检查）
deploy-safe:
	@echo "开始安全部署..."
	@if docker compose build --progress=plain; then \
		echo "构建成功，启动服务..."; \
		if docker compose up -d; then \
			echo "服务启动成功！"; \
			docker compose ps; \
		else \
			echo "服务启动失败！"; \
			docker compose logs; \
			exit 1; \
		fi \
	else \
		echo "构建失败！"; \
		exit 1; \
	fi

# 查看构建详细日志
build-debug:
	@echo "详细构建日志模式..."
	docker compose build --progress=plain --no-cache

# 清理命令
clean:
	docker compose down -v
	docker compose rm -f

# 查看日志
logs:
	docker compose logs -f

# 查看各个服务的日志
frontend-logs:
	docker compose logs frontend -f

backend-logs:
	docker compose logs backend -f

redis-logs:
	docker compose logs redis -f

nginx-logs:
	docker compose logs nginx -f

# Shell 访问
backend-sh:
	docker compose exec backend sh

frontend-sh:
	docker compose exec frontend sh

# 重启特定服务
restart-frontend:
	docker compose restart frontend

restart-backend:
	docker compose restart backend

restart-nginx:
	docker compose restart nginx

# 开发命令
dev-start: dev-stop
	@echo "启动开发环境..."
	@mkdir -p logs
	@touch logs/backend.log logs/frontend.log
	@make backend-dev & make frontend-dev &
	@echo "开发环境已启动"
	@echo "后端日志: tail -f logs/backend.log"
	@echo "前端日志: tail -f logs/frontend.log"

# 停止开发环境
dev-stop:
	@echo "停止开发环境..."
	@-pkill -f "go run cmd/server/main.go" 2>/dev/null || true
	@-pkill -f "node.*start" 2>/dev/null || true
	@-rm -f logs/backend.log logs/frontend.log 2>/dev/null || true
	@echo "开发环境已停止"

# 后端开发服务
backend-dev:
	@echo "启动后端服务..."
	@cd backend && go run cmd/server/main.go --proxy http://localhost:10086 2>&1 | tee ../logs/backend.log

# 前端开发服务
frontend-dev:
	@echo "启动前端服务..."
	@cd frontend && yarn start 2>&1 | tee ../logs/frontend.log 