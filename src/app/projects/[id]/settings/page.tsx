"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  const [obsidianUrl, setObsidianUrl] = useState("http://127.0.0.1:27123");
  const [obsidianKey, setObsidianKey] = useState("");
  const [nlmUrl, setNlmUrl] = useState("");
  const [zoteroKey, setZoteroKey] = useState("");
  const [zoteroUserId, setZoteroUserId] = useState("");
  const [zoteroStatus, setZoteroStatus] = useState<string | null>(null);
  const [university, setUniversity] = useState("sysu");
  const [proxyEnabled, setProxyEnabled] = useState(false);

  useEffect(() => {
    setNlmUrl(localStorage.getItem("notebooklm_url") ?? "");
    setObsidianKey(localStorage.getItem("obsidian_api_key") ?? "");
    setZoteroKey(localStorage.getItem("zotero_api_key") ?? "");
    setZoteroUserId(localStorage.getItem("zotero_user_id") ?? "");
    setUniversity(localStorage.getItem("university_id") ?? "sysu");
    setProxyEnabled(localStorage.getItem("proxy_enabled") === "true");
    const savedUrl = localStorage.getItem("obsidian_base_url");
    if (savedUrl) setObsidianUrl(savedUrl);
  }, []);
  const [obsidianStatus, setObsidianStatus] = useState<{
    connected: boolean;
    vaultName?: string;
    error?: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkObsidian() {
    setChecking(true);
    try {
      // Call Obsidian directly from the browser (not via Vercel server)
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (obsidianKey) headers["Authorization"] = `Bearer ${obsidianKey}`;

      const res = await fetch(`${obsidianUrl}/`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const data = await res.json();
        setObsidianStatus({
          connected: true,
          vaultName: data.service ?? "Obsidian Vault",
        });
      } else {
        setObsidianStatus({
          connected: false,
          error: `Obsidian 返回 HTTP ${res.status}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error && err.name === "TimeoutError"
        ? "连接超时 — 请确认 Obsidian 已启动且 Local REST API 插件已开启"
        : "无法连接 — 请确认 Obsidian 正在运行，且 Local REST API 插件已启用（端口 27123）";
      setObsidianStatus({ connected: false, error: msg });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold">
          项目设置
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          配置外部工具集成
        </p>
      </div>

      {/* Obsidian Integration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-lg">
            <span className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center text-purple-700 text-sm font-bold">
              O
            </span>
            Obsidian 集成
            {obsidianStatus && (
              <Badge
                variant="secondary"
                className={
                  obsidianStatus.connected
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }
              >
                {obsidianStatus.connected ? "已连接" : "未连接"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            连接本地 Obsidian，实现双向同步：将研究想法推送到 vault，或从笔记中提取想法种子。
          </p>

          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium">设置步骤：</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>在 Obsidian 中安装 <strong>Local REST API</strong> 插件</li>
              <li>打开插件设置，找到 <strong>API Key</strong></li>
              <li>将 API Key 粘贴到下方输入框</li>
              <li>点击"测试连接"</li>
            </ol>
          </div>

          <div className="grid gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Obsidian REST API 地址
              </label>
              <Input
                value={obsidianUrl}
                onChange={(e) => {
                  setObsidianUrl(e.target.value);
                  localStorage.setItem("obsidian_base_url", e.target.value);
                }}
                placeholder="http://127.0.0.1:27123"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                API Key
              </label>
              <Input
                type="password"
                value={obsidianKey}
                onChange={(e) => {
                  setObsidianKey(e.target.value);
                  localStorage.setItem("obsidian_api_key", e.target.value);
                }}
                placeholder="在 Obsidian Local REST API 插件设置中找到"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={checkObsidian}
              disabled={checking}
              variant="outline"
            >
              {checking ? "检测中..." : "测试连接"}
            </Button>

            {obsidianStatus?.connected && (
              <span className="text-sm text-green-600">
                已连接到 {obsidianStatus.vaultName}
              </span>
            )}
            {obsidianStatus && !obsidianStatus.connected && (
              <span className="text-sm text-red-600">
                {obsidianStatus.error}
              </span>
            )}
          </div>

          {obsidianStatus?.connected && (
            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium">连接成功后可以：</p>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-lg border border-border/50">
                  <p className="font-medium text-teal">推送到 Obsidian</p>
                  <p className="text-muted-foreground mt-1">
                    在文献检索和想法生成页面，点击"推送到 Obsidian"按钮
                  </p>
                </div>
                <div className="p-3 rounded-lg border border-border/50">
                  <p className="font-medium text-teal">从 Obsidian 拉取</p>
                  <p className="text-muted-foreground mt-1">
                    在想法生成页面，读取你的笔记作为 AI 生成的种子
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* NotebookLM Integration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-lg">
            <span className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-bold">
              N
            </span>
            NotebookLM 集成
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            将核心文献 PDF 上传到 NotebookLM，平台自动调用 Gemini 进行基于全文的 RAG 深度分析。
          </p>

          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium">使用流程：</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>在 <a href="https://notebooklm.google.com" target="_blank" rel="noopener noreferrer" className="text-teal underline">notebooklm.google.com</a> 创建新 Notebook <span className="text-red-400 text-xs">（大陆需代理）</span></li>
              <li>上传研究相关的 PDF 文献（最多 50 篇）</li>
              <li>点击右上角 &quot;Share&quot; → &quot;Anyone with the link&quot; → 复制链接</li>
              <li>将链接粘贴到下方</li>
              <li>在文献综述/想法生成页面开启 &quot;NotebookLM 增强&quot;</li>
            </ol>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              NotebookLM Notebook URL
            </label>
            <Input
              placeholder="https://notebooklm.google.com/notebook/..."
              value={nlmUrl}
              onChange={(e) => {
                setNlmUrl(e.target.value);
                localStorage.setItem("notebooklm_url", e.target.value);
              }}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              分析模式
            </label>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="nlm-mode" value="manual" defaultChecked className="accent-teal" />
                <span>手动模式 <span className="text-muted-foreground">（平台生成问题，你在 NotebookLM 中提问）</span></span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="nlm-mode" value="auto" className="accent-teal" />
                <span>自动模式 <span className="text-muted-foreground">（需要本地代理服务）</span></span>
              </label>
            </div>
          </div>

          <div className="border-t pt-4 space-y-2">
            <p className="text-sm font-medium">NotebookLM 在流程中的作用：</p>
            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg border border-border/50">
                <p className="font-medium text-blue-600">文献综述</p>
                <p className="text-muted-foreground mt-1">
                  基于全文提取主要发现、矛盾结论、研究空白，比仅靠摘要更准确
                </p>
              </div>
              <div className="p-3 rounded-lg border border-border/50">
                <p className="font-medium text-blue-600">变量提取</p>
                <p className="text-muted-foreground mt-1">
                  从全文中提取 IV/DV/中介/调节，包括效应量、样本量等细节
                </p>
              </div>
              <div className="p-3 rounded-lg border border-border/50">
                <p className="font-medium text-blue-600">理论分析</p>
                <p className="text-muted-foreground mt-1">
                  识别各文献的理论框架、核心假设和边界条件
                </p>
              </div>
              <div className="p-3 rounded-lg border border-border/50">
                <p className="font-medium text-blue-600">想法生成</p>
                <p className="text-muted-foreground mt-1">
                  基于全文发现未被验证的情境和理论空白
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Institutional Proxy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-lg">
            <span className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-700 text-sm font-bold">
              🏫
            </span>
            机构全文访问
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            在校园网或 VPN 环境下，平台可通过学校 IP 认证自动获取 Elsevier、Springer、Nature、Wiley、SAGE 等出版商的论文全文。
          </p>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={proxyEnabled}
                onChange={(e) => {
                  setProxyEnabled(e.target.checked);
                  localStorage.setItem("proxy_enabled", String(e.target.checked));
                }}
                className="accent-teal"
              />
              <span className="text-sm font-medium">启用机构全文访问</span>
            </label>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">选择学校</label>
            <select
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
              value={university}
              onChange={(e) => {
                setUniversity(e.target.value);
                localStorage.setItem("university_id", e.target.value);
              }}
            >
              <option value="sysu">中山大学</option>
              <option value="tsinghua">清华大学</option>
              <option value="pku">北京大学</option>
              <option value="sjtu">上海交通大学</option>
              <option value="fudan">复旦大学</option>
              <option value="zju">浙江大学</option>
              <option value="nju">南京大学</option>
              <option value="whu">武汉大学</option>
              <option value="ruc">中国人民大学</option>
              <option value="xmu">厦门大学</option>
            </select>
          </div>

          {/* Dynamic VPN info based on selected university */}
          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-3">
            <p className="font-medium">使用方法：</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">校内</span>：连接校园 Wi-Fi 即可，无需额外配置
              </li>
              <li>
                <span className="font-medium text-foreground">校外</span>：先连接学校 VPN，再使用平台
              </li>
              <li>如果使用 Clash/VeloceMan 等代理软件，需将学术出版商域名设为<span className="font-medium text-foreground">直连</span>（平台已自动配置）</li>
              <li>搜索文献后，点击「阅读全文」或「学校访问」按钮</li>
            </ol>

            <div className="border-t border-border/50 pt-2 mt-2">
              <p className="text-xs font-medium mb-1">
                {university === "sysu" && "中山大学 VPN"}
                {university === "tsinghua" && "清华大学 VPN"}
                {university === "pku" && "北京大学 VPN"}
                {university === "sjtu" && "上海交通大学 VPN"}
                {university === "fudan" && "复旦大学 VPN"}
                {university === "zju" && "浙江大学 VPN"}
                {university === "nju" && "南京大学 VPN"}
                {university === "whu" && "武汉大学 VPN"}
                {university === "ruc" && "中国人民大学 VPN"}
                {university === "xmu" && "厦门大学 VPN"}
              </p>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {university === "sysu" && (
                  <>
                    <p>VPN 地址：<a href="https://vpn.sysu.edu.cn" target="_blank" rel="noopener noreferrer" className="text-teal underline">vpn.sysu.edu.cn</a>（EasyConnect）</p>
                    <p>也支持 CARSI 联邦认证登录</p>
                  </>
                )}
                {university === "tsinghua" && (
                  <>
                    <p>VPN 地址：<a href="https://sslvpn.tsinghua.edu.cn" target="_blank" rel="noopener noreferrer" className="text-teal underline">sslvpn.tsinghua.edu.cn</a>（Pulse Secure）</p>
                    <p>也支持 CARSI 联邦认证：<a href="https://www.lib.tsinghua.edu.cn/service/carsi.html" target="_blank" rel="noopener noreferrer" className="text-teal underline">使用说明</a></p>
                  </>
                )}
                {university === "pku" && (
                  <>
                    <p>WebVPN：<a href="https://vpn.pku.edu.cn" target="_blank" rel="noopener noreferrer" className="text-teal underline">vpn.pku.edu.cn</a></p>
                    <p>也支持 CARSI 联邦认证</p>
                  </>
                )}
                {university === "sjtu" && (
                  <>
                    <p>VPN 地址：<a href="https://vpn.sjtu.edu.cn" target="_blank" rel="noopener noreferrer" className="text-teal underline">vpn.sjtu.edu.cn</a>（EasyConnect）</p>
                    <p>也支持 CARSI 联邦认证登录</p>
                  </>
                )}
                {university === "fudan" && (
                  <>
                    <p>WebVPN：<a href="https://vpn.fudan.edu.cn" target="_blank" rel="noopener noreferrer" className="text-teal underline">vpn.fudan.edu.cn</a></p>
                    <p>也支持 CARSI 联邦认证</p>
                  </>
                )}
                {(university === "zju" || university === "nju" || university === "whu" || university === "ruc" || university === "xmu") && (
                  <p>校外请先连接学校 VPN，也可使用 CARSI 联邦认证访问数据库</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Zotero Integration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-lg">
            <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-red-700 text-sm font-bold">
              Z
            </span>
            Zotero 参考文献管理
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            连接 Zotero 账号，导入/导出参考文献，自动生成 APA/BibTeX 格式引用。
          </p>

          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium">配置步骤：</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>访问 <a href="https://www.zotero.org/settings/keys/new" target="_blank" rel="noopener noreferrer" className="text-teal underline">Zotero API Key 设置</a></li>
              <li>创建新 API Key（勾选 &quot;Allow library access&quot;）</li>
              <li>获取你的 User ID（在 <a href="https://www.zotero.org/settings/keys" target="_blank" rel="noopener noreferrer" className="text-teal underline">同一页面</a> 顶部显示）</li>
              <li>将 API Key 和 User ID 填入下方</li>
            </ol>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Zotero API Key</label>
              <Input
                type="password"
                placeholder="xxxxxxxxxxxxxxxxxxx"
                value={zoteroKey}
                onChange={(e) => {
                  setZoteroKey(e.target.value);
                  localStorage.setItem("zotero_api_key", e.target.value);
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">User ID</label>
              <Input
                placeholder="12345678"
                value={zoteroUserId}
                onChange={(e) => {
                  setZoteroUserId(e.target.value);
                  localStorage.setItem("zotero_user_id", e.target.value);
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={async () => {
                if (!zoteroKey || !zoteroUserId) {
                  setZoteroStatus("请先填写 API Key 和 User ID");
                  return;
                }
                try {
                  const res = await fetch("/api/integrations/zotero", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "collections",
                      apiKey: zoteroKey,
                      userId: zoteroUserId,
                    }),
                  });
                  const data = await res.json();
                  if (data.collections) {
                    setZoteroStatus(
                      `连接成功！找到 ${data.collections.length} 个文献集：${data.collections.map((c: { name: string }) => c.name).slice(0, 3).join(", ")}${data.collections.length > 3 ? "..." : ""}`
                    );
                  } else {
                    setZoteroStatus(`连接失败: ${data.error ?? "未知错误"}`);
                  }
                } catch {
                  setZoteroStatus("连接失败，请检查网络");
                }
              }}
            >
              测试连接
            </Button>
            {zoteroStatus && (
              <span className={`text-xs ${zoteroStatus.includes("成功") ? "text-green-600" : "text-red-500"}`}>
                {zoteroStatus}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
