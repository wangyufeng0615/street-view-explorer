.PHONY: deploy clean logs backend-sh frontend-sh frontend-logs redis-logs nginx-logs

# 部署命令
deploy:
	docker compose up -d --build

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