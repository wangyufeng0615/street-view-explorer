.PHONY: build test lint clean init-data

# 构建命令
build:
	@echo "构建后端应用..."
	@go build -o bin/server cmd/server/main.go

# 测试命令
test:
	@echo "运行测试..."
	@go test -v -race -cover ./...

# 代码检查
lint:
	@echo "运行代码检查..."
	@golangci-lint run

# 初始化测试数据
init-data:
	@echo "初始化测试数据..."
	@go run scripts/init_redis.go

# 清理命令
clean:
	@echo "清理构建产物..."
	@rm -rf bin/
	@rm -rf tmp/
	@go clean -testcache

# 开发相关命令
run:
	@echo "启动开发服务器..."
	@go run cmd/server/main.go

# 生成 mock
mock:
	@echo "生成 mock 文件..."
	@mockgen -source=internal/repositories/repository.go -destination=internal/repositories/mock/repository.go
	@mockgen -source=internal/services/maps_service.go -destination=internal/services/mock/maps_service.go

# 更新依赖
deps-update:
	@echo "更新依赖..."
	@go get -u ./...
	@go mod tidy

# 检查依赖安全性
deps-check:
	@echo "检查依赖安全性..."
	@go list -json -m all | nancy sleuth