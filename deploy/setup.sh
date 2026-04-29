#!/bin/bash
# ScholarFlow 服务器初始化脚本
# 在腾讯云香港轻量服务器上以 root 运行

set -e

echo "=== 1. 系统更新 ==="
apt update && apt upgrade -y

echo "=== 2. 安装 Docker ==="
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

echo "=== 3. 安装 Docker Compose ==="
apt install -y docker-compose-plugin

echo "=== 4. 安装 Nginx + Certbot ==="
apt install -y nginx certbot python3-certbot-nginx

echo "=== 5. 安装 Git ==="
apt install -y git

echo "=== 6. 配置防火墙 ==="
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo ""
echo "=========================================="
echo "  服务器初始化完成！"
echo "  接下来请按照部署教程继续操作"
echo "=========================================="
