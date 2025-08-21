# 构建阶段
FROM golang:1.22.2-alpine AS builder

WORKDIR /app

# 安装构建依赖
RUN apk add --no-cache git

# 首先只复制依赖文件
COPY go.mod go.sum ./
RUN go mod download

# 复制源代码，但排除不需要的文件
COPY cmd/ ./cmd/
COPY internal/ ./internal/

# 构建应用
RUN CGO_ENABLED=0 GOOS=linux go build -o main ./cmd/server

# 运行阶段
FROM alpine:3.19

WORKDIR /app

# 安装运行时依赖（只保留必要的）
RUN apk add --no-cache ca-certificates tzdata

# 复制编译好的应用
COPY --from=builder /app/main .

# 设置时区
ENV TZ=Asia/Shanghai

# 创建非root用户运行应用
RUN adduser -D -u 1001 appuser && chown -R appuser:appuser /app
USER appuser

# 健康检查 - 使用Go应用自身的健康检查端点
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["/app/main", "health"]

# 暴露端口
EXPOSE 8080

# 运行应用
CMD ["./main"] 