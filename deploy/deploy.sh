#!/bin/bash
# ScholarFlow 部署/更新脚本
# 在服务器的 /opt/scholarflow 目录下运行

set -e

echo "=== 拉取最新代码 ==="
git pull origin main

echo "=== 构建并重启容器 ==="
docker compose up -d --build

echo "=== 等待服务启动 ==="
sleep 5

# 健康检查
if curl -sf http://127.0.0.1:3000 > /dev/null 2>&1; then
    echo "✅ ScholarFlow 部署成功！"
else
    echo "❌ 服务未正常启动，请检查日志："
    echo "   docker compose logs -f"
fi
