.PHONY: deploy clean logs backend-sh frontend-sh

# 部署命令
deploy:
	@echo "Deploying to production environment..."
	docker-compose up -d --build

# 清理命令
clean:
	docker-compose down -v
	docker system prune -f
	rm -rf backend/tmp/* frontend/build/*

# 查看日志
logs:
	docker-compose logs -f

# Shell 访问
backend-sh:
	docker-compose exec backend sh

frontend-sh:
	docker-compose exec frontend sh 