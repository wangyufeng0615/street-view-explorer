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

# 安装运行时依赖
RUN apk add --no-cache ca-certificates tzdata wget

# 复制编译好的应用
COPY --from=builder /app/main .

# 设置时区
ENV TZ=Asia/Shanghai

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -O- http://localhost:8080/health || exit 1

# 暴露端口
EXPOSE 8080

# 运行应用
CMD ["./main"] 