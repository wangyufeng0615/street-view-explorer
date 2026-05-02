SHELL := /bin/bash

LOG_DIR := logs/dev
BACKEND_LOG := $(LOG_DIR)/backend.log
FRONTEND_LOG := $(LOG_DIR)/frontend.log
BACKEND_PID := $(LOG_DIR)/backend.pid
FRONTEND_PID := $(LOG_DIR)/frontend.pid
REMOTE_HOST ?= kr
REMOTE_DIR ?= /root/street-view-explorer
REMOTE_BRANCH ?= main
LOCAL_GIT_REMOTE ?= origin
REMOTE_GIT_REMOTE ?= origin
HEALTH_TIMEOUT ?= 240

.PHONY: deploy deploy-remote clean dev dev-start dev-stop backend-dev frontend-dev

# 前台启动开发环境（Ctrl+C 同时停止）
dev:
	@trap 'kill 0' INT TERM; \
	(cd backend && go run cmd/server/main.go 2>&1 | sed 's/^/[BE] /') & \
	(cd frontend && yarn dev 2>&1 | sed 's/^/[FE] /') & \
	wait

# 部署命令
deploy:
	@echo "正在构建和部署服务..."
	docker compose build --progress=plain
	@echo "构建完成，启动服务..."
	docker compose up -d
	@echo "检查服务状态..."
	docker compose ps
	@echo "部署完成！"

deploy-remote:
	@REMOTE_HOST="$(REMOTE_HOST)" \
	REMOTE_DIR="$(REMOTE_DIR)" \
	REMOTE_BRANCH="$(REMOTE_BRANCH)" \
	LOCAL_GIT_REMOTE="$(LOCAL_GIT_REMOTE)" \
	REMOTE_GIT_REMOTE="$(REMOTE_GIT_REMOTE)" \
	HEALTH_TIMEOUT="$(HEALTH_TIMEOUT)" \
	scripts/remote_deploy.sh

# 清理命令
clean:
	docker compose down -v
	docker compose rm -f

# 启动本地开发环境（backend + frontend）
dev-start:
	@mkdir -p $(LOG_DIR)
	@$(MAKE) backend-dev
	@$(MAKE) frontend-dev
	@echo "开发环境已启动"
	@echo "Backend 日志: $(BACKEND_LOG)"
	@echo "Frontend 日志: $(FRONTEND_LOG)"

# 停止本地开发环境
dev-stop:
	@mkdir -p $(LOG_DIR)
	@if [ -f "$(BACKEND_PID)" ]; then \
		pid=$$(cat "$(BACKEND_PID)"); \
		if kill -0 $$pid 2>/dev/null; then \
			echo "停止 Backend (PID: $$pid)"; \
			kill $$pid >/dev/null 2>&1 || true; \
			sleep 1; \
			if kill -0 $$pid 2>/dev/null; then \
				kill -9 $$pid >/dev/null 2>&1 || true; \
			fi; \
		else \
			echo "Backend 进程不存在，清理 PID 文件"; \
		fi; \
		rm -f "$(BACKEND_PID)"; \
	else \
		echo "Backend 未运行"; \
	fi
	@if [ -f "$(FRONTEND_PID)" ]; then \
		pid=$$(cat "$(FRONTEND_PID)"); \
		if kill -0 $$pid 2>/dev/null; then \
			echo "停止 Frontend (PID: $$pid)"; \
			kill $$pid >/dev/null 2>&1 || true; \
			sleep 1; \
			if kill -0 $$pid 2>/dev/null; then \
				kill -9 $$pid >/dev/null 2>&1 || true; \
			fi; \
		else \
			echo "Frontend 进程不存在，清理 PID 文件"; \
		fi; \
		rm -f "$(FRONTEND_PID)"; \
	else \
		echo "Frontend 未运行"; \
	fi
	@echo "开发环境已停止"

# 单独启动 backend
backend-dev:
	@mkdir -p $(LOG_DIR)
	@if [ -f "$(BACKEND_PID)" ] && kill -0 $$(cat "$(BACKEND_PID)") 2>/dev/null; then \
		echo "Backend 已在运行 (PID: $$(cat "$(BACKEND_PID)"))"; \
	else \
		rm -f "$(BACKEND_PID)"; \
		echo "启动 Backend..."; \
		(cd backend && nohup go run cmd/server/main.go > ../$(BACKEND_LOG) 2>&1 & echo $$! > ../$(BACKEND_PID)); \
		echo "Backend 已启动 (PID: $$(cat "$(BACKEND_PID)"))"; \
	fi

# 单独启动 frontend
frontend-dev:
	@mkdir -p $(LOG_DIR)
	@if [ -f "$(FRONTEND_PID)" ] && kill -0 $$(cat "$(FRONTEND_PID)") 2>/dev/null; then \
		echo "Frontend 已在运行 (PID: $$(cat "$(FRONTEND_PID)"))"; \
	else \
		rm -f "$(FRONTEND_PID)"; \
		echo "启动 Frontend..."; \
		(cd frontend && nohup yarn dev > ../$(FRONTEND_LOG) 2>&1 & echo $$! > ../$(FRONTEND_PID)); \
		echo "Frontend 已启动 (PID: $$(cat "$(FRONTEND_PID)"))"; \
	fi
