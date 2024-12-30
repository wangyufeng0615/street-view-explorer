#!/bin/bash

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 默认值
REDIS_ADDR=${REDIS_ADDRESS:-"localhost:6379"}
DATA_FILE="$PROJECT_ROOT/data/locations.json"

# 编译并运行初始化程序
cd "$PROJECT_ROOT" && go run scripts/init_redis.go -redis="$REDIS_ADDR" -data="$DATA_FILE" 