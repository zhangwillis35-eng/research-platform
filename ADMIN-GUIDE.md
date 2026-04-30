# ScholarFlow 管理指南

## 管理后台

- 地址：https://scholarflow-willis.cn/admin
- 账号：`zhanglw56`
- 密码：`zhang040206A@`

### 功能

| 模块 | 说明 |
|------|------|
| Overview | 用户数、项目数、论文数、搜索次数、对话次数 |
| Pending Registrations | 新用户注册审批（Approve & Send / Reject） |
| Daily Activity | 最近 14 天的搜索、对话、论文、新用户趋势图 |
| Users | 每个用户的项目、活动量、最后活跃时间（点击展开详情） |

### 注册审批流程

1. 用户在 https://scholarflow-willis.cn/login 提交注册申请
2. 你在管理后台看到 Pending Registrations
3. 点击 **Approve & Send** → 系统自动发送邀请码邮件到用户邮箱
4. 用户收到邮件后，在登录页点击「已有邀请码」→ 输入邀请码 → 完成注册

> 如果 SMTP 未配置，审批时会弹窗显示邀请码，你手动发给用户即可。

---

## 服务器信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | 103.38.80.155 |
| 系统 | Ubuntu 22.04 |
| 项目路径 | /opt/scholarflow |
| 域名 | scholarflow-willis.cn |
| 数据库 | Neon PostgreSQL（新加坡） |
| 文件存储 | 阿里云 OSS（香港） |

### SSH 登录

```bash
ssh root@103.38.80.155
```

---

## 开发流程

### 本地开发

```bash
cd ~/Projects/research-platform
npm run dev
# 访问 http://localhost:3000
```

本地和生产共用同一个 Neon 数据库，代码改动实时热更新。

### 部署到生产

```bash
# 1. 本地提交并推送
git add -A && git commit -m "描述改动" && git push

# 2. SSH 到服务器
ssh root@103.38.80.155

# 3. 拉取代码并重新构建
cd /opt/scholarflow && git pull && docker compose down && docker compose up -d --build
```

### 数据库变更

修改 `prisma/schema.prisma` 后：

```bash
# 推送 schema 到数据库
npx prisma db push

# 重新生成 Prisma Client
npx prisma generate

# 清除缓存并重启
rm -rf .next && npm run dev
```

### 常见问题

**Turbopack 缓存损坏（页面报 Internal Server Error）**

```bash
rm -rf .next && npm run dev
```

**Docker 构建慢**

首次构建需要 5-10 分钟（npm ci），后续构建有缓存会快很多。

**查看生产日志**

```bash
ssh root@103.38.80.155
cd /opt/scholarflow && docker compose logs -f --tail=100
```

---

## 环境变量（服务器 .env）

| 变量 | 用途 |
|------|------|
| DATABASE_URL | Neon PostgreSQL 连接串 |
| ANTHROPIC_API_KEY | Claude API |
| DEEPSEEK_API_KEY | DeepSeek API |
| GEMINI_API_KEY | Gemini API |
| OPENAI_API_KEY | GPT-4o API |
| SERPER_API_KEY | Google Scholar 搜索 |
| SEMANTIC_SCHOLAR_API_KEY | Semantic Scholar API |
| SERPAPI_KEY | SerpAPI |
| OSS_ACCESS_KEY_ID / SECRET | 阿里云 OSS |
| OSS_BUCKET / REGION | OSS 桶名和区域 |
| SMTP_USER | QQ 邮箱地址（发送邀请码） |
| SMTP_PASS | QQ 邮箱授权码（非登录密码） |
| ADMIN_SECRET | 旧版管理 API 密钥 |
