#!/bin/bash
# ScholarFlow 部署脚本 — 在阿里云服务器上运行
set -e

echo "=== ScholarFlow 部署脚本 ==="

# 1. 安装 Docker (如果没有)
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl start docker
    systemctl enable docker
fi

# 2. 安装 Docker Compose
if ! command -v docker compose &> /dev/null; then
    echo "Installing Docker Compose..."
    apt-get update && apt-get install -y docker-compose-plugin
fi

# 3. 安装 Nginx
if ! command -v nginx &> /dev/null; then
    echo "Installing Nginx..."
    apt-get update && apt-get install -y nginx
fi

# 4. 构建并启动应用
echo "Building and starting ScholarFlow..."
docker compose down 2>/dev/null || true
docker compose up -d --build

# 5. 配置 Nginx
echo "Configuring Nginx..."
cp nginx.conf /etc/nginx/sites-available/scholarflow
ln -sf /etc/nginx/sites-available/scholarflow /etc/nginx/sites-enabled/scholarflow
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "=== 部署完成！ ==="
echo "访问 http://$(curl -s ifconfig.me) 即可使用"
echo ""
echo "常用命令："
echo "  查看日志: docker compose logs -f"
echo "  重启应用: docker compose restart"
echo "  更新部署: git pull && docker compose up -d --build"
