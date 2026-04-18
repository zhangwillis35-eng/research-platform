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

  useEffect(() => {
    setNlmUrl(localStorage.getItem("notebooklm_url") ?? "");
    setObsidianKey(localStorage.getItem("obsidian_api_key") ?? "");
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
        <h1 className="font-[family-name:var(--font-serif-sc)] text-2xl font-bold">
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
              <li>在 <a href="https://notebooklm.google.com" target="_blank" rel="noopener noreferrer" className="text-teal underline">notebooklm.google.com</a> 创建新 Notebook</li>
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
    </div>
  );
}
