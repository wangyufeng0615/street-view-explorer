.PHONY: deploy clean logs backend-sh frontend-sh init-cert renew-cert

# 域名配置
DOMAIN ?= earth.wangyufeng.org
EMAIL ?= alanwang424@gmail.com

# 部署命令
deploy:
	@echo "Deploying to production environment..."
	@mkdir -p nginx/conf.d nginx/ssl certbot/conf certbot/www
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

# 初始化 SSL 证书
init-cert:
	@echo "Initializing SSL certificate for $(DOMAIN)..."
	docker-compose run --rm certbot certonly --webroot --webroot-path=/var/www/certbot \
		--email $(EMAIL) --agree-tos --no-eff-email \
		-d $(DOMAIN)

# 更新 SSL 证书
renew-cert:
	@echo "Renewing SSL certificates..."
	docker-compose run --rm certbot renew 