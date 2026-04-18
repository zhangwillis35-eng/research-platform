"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  const [obsidianUrl, setObsidianUrl] = useState("http://127.0.0.1:27123");
  const [obsidianKey, setObsidianKey] = useState("");
  const [obsidianStatus, setObsidianStatus] = useState<{
    connected: boolean;
    vaultName?: string;
    error?: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkObsidian() {
    setChecking(true);
    try {
      const res = await fetch("/api/integrations/obsidian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check",
          config: { baseUrl: obsidianUrl, apiKey: obsidianKey },
        }),
      });
      const data = await res.json();
      setObsidianStatus(data);
    } catch {
      setObsidianStatus({ connected: false, error: "请求失败" });
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
                onChange={(e) => setObsidianUrl(e.target.value)}
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
                onChange={(e) => setObsidianKey(e.target.value)}
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

      {/* NotebookLM placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-lg">
            <span className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-bold">
              N
            </span>
            NotebookLM 集成
            <Badge variant="secondary" className="text-xs">即将上线</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            将核心文献上传到 NotebookLM，平台通过 MCP 协议自动调用 Gemini 进行基于全文的 RAG 分析。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
