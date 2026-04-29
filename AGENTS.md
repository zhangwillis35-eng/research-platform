<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
