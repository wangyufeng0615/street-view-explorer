.PHONY: deploy clean logs backend-sh frontend-sh init-cert renew-cert init-dirs

# 域名配置
DOMAIN ?= earth.wangyufeng.org
EMAIL ?= alanwang424@gmail.com

# 初始化必要的目录
init-dirs:
	@echo "Creating required directories..."
	@mkdir -p nginx/conf.d nginx/ssl certbot/conf certbot/www

# 部署命令
deploy: init-dirs
	@echo "Deploying to production environment..."
	docker-compose up -d --build

# 清理命令
clean:
	docker-compose down -v
	docker system prune -f
	rm -rf backend/tmp/* frontend/build/*
	rm -rf nginx/conf.d/* nginx/ssl/* certbot/conf/* certbot/www/*

# 查看日志
logs:
	docker-compose logs -f

# Shell 访问
backend-sh:
	docker-compose exec backend sh

frontend-sh:
	docker-compose exec frontend sh

# 初始化 SSL 证书
init-cert: init-dirs
	@echo "Initializing SSL certificate for $(DOMAIN)..."
	docker-compose run --rm certbot certonly --webroot --webroot-path=/var/www/certbot \
		--email $(EMAIL) --agree-tos --no-eff-email \
		-d $(DOMAIN)

# 更新 SSL 证书
renew-cert:
	@echo "Renewing SSL certificates..."
	docker-compose run --rm certbot renew 