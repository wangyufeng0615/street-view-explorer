.PHONY: dev prod clean

# 开发环境变量
DEV_ENV ?= development
DEV_REDIS_PASSWORD ?= 16DB5A5B-D9C9-4263-A85A-6E347EA219E6
DEV_API_BASE_URL ?= http://localhost:8080
DEV_CORS_ALLOWED_ORIGINS ?= http://localhost:3000

# 生产环境变量
PROD_ENV ?= production
PROD_REDIS_PASSWORD ?= $(shell uuidgen)
PROD_API_BASE_URL ?= https://api.yoursite.com
PROD_CORS_ALLOWED_ORIGINS ?= https://yoursite.com

# Docker 相关命令
dev: export ENV=$(DEV_ENV)
dev: export REDIS_PASSWORD=$(DEV_REDIS_PASSWORD)
dev: export API_BASE_URL=$(DEV_API_BASE_URL)
dev: export CORS_ALLOWED_ORIGINS=$(DEV_CORS_ALLOWED_ORIGINS)
dev:
	@echo "Starting development environment..."
	docker-compose -f docker-compose.yml up --build

prod: export ENV=$(PROD_ENV)
prod: export REDIS_PASSWORD=$(PROD_REDIS_PASSWORD)
prod: export API_BASE_URL=$(PROD_API_BASE_URL)
prod: export CORS_ALLOWED_ORIGINS=$(PROD_CORS_ALLOWED_ORIGINS)
prod:
	@echo "Starting production environment..."
	@echo "Redis password: $(PROD_REDIS_PASSWORD)"
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

clean:
	docker-compose down -v
	docker system prune -f
	rm -rf backend/tmp/* frontend/build/*

# 辅助命令
logs:
	docker-compose logs -f

redis-cli:
	docker-compose exec redis redis-cli -a "$(REDIS_PASSWORD)"

backend-sh:
	docker-compose exec backend sh

frontend-sh:
	docker-compose exec frontend sh 