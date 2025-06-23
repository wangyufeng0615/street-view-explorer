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
