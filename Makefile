.PHONY: deploy clean dev-start dev-stop backend-dev frontend-dev

# 部署命令
deploy:
	@echo "正在构建和部署服务..."
	docker compose build --progress=plain
	@echo "构建完成，启动服务..."
	docker compose up -d
	@echo "检查服务状态..."
	docker compose ps
	@echo "部署完成！"

# 清理命令
clean:
	docker compose down -v
	docker compose rm -f

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