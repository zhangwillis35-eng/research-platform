<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 部署流程

每次迭代优化 ScholarFlow 之后，都必须同步推送到服务器：

1. 提交并推送代码到 GitHub：`git push`
2. 提醒用户 **SSH 登录服务器后** 执行：
   ```bash
   ssh root@103.38.80.155
   cd /opt/scholarflow && git pull && docker compose down && docker compose up -d --build
   ```
   **注意：** 用户的开发机是 Mac，`/opt/scholarflow` 目录在远程服务器上，不是本地。务必先提醒用户 SSH 登录，不要直接给出 `cd /opt/scholarflow` 命令。

## 常见问题修复

### Turbopack 缓存损坏（页面报 Internal Server Error）

如果遇到以下错误：
- `TurbopackInternalError: Failed to lookup task ids`
- `Unable to open static sorted file`
- `ENOENT: no such file or directory` 指向 `.next/dev/cache/turbopack/`

直接运行：
```bash
rm -rf .next && npm run dev
```
