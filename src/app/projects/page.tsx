"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface Project {
  id: string;
  name: string;
  domain?: string;
  description?: string;
  _count: { papers: number; ideas: number };
}

const NOTICE_KEY = "sf-network-notice-dismissed";

const fullyAvailable = [
  { name: "注册 / 登录", desc: "邮箱注册、邀请码验证、登录登出" },
  { name: "文献检索", desc: "Semantic Scholar、OpenAlex、Google Scholar、arXiv、CORE、Web of Science" },
  { name: "AI 对话与分析", desc: "DeepSeek、Claude、GPT-4o、Gemini 四大模型" },
  { name: "PDF 上传与存储", desc: "阿里云 OSS 存储，全文提取" },
  { name: "文献综述 / 知识图谱 / 研究想法", desc: "所有 AI 驱动的分析功能" },
  { name: "参考文献导出", desc: "APA / MLA / Chicago / BibTeX" },
  { name: "期刊排名查询", desc: "FT50、UTD24、ABS、CCF 等" },
];

const limited = [
  { name: "论文原始链接", desc: "点击论文标题跳转出版商网站时部分链接可能无法打开", tip: "可使用 PDF 上传功能替代" },
  { name: "Connected Papers 外链", desc: "引用网络可视化工具的外部链接可能不稳定", tip: "可使用内置知识图谱替代" },
  { name: "Google Scholar 页面外链", desc: "「在 Google Scholar 中查看」等外链无法打开", tip: "搜索功能本身不受影响" },
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNotice, setShowNotice] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionStorage.getItem(NOTICE_KEY)) {
      setShowNotice(true);
    }
  }, []);

  function dismissNotice() {
    sessionStorage.setItem(NOTICE_KEY, "1");
    setShowNotice(false);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/projects?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== id));
      }
    } catch { /* ignore */ }
    setDeleting(null);
    setConfirmId(null);
  }

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Network compatibility notice — shown once per session */}
      {showNotice && (
        <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl mx-auto py-8">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center mx-auto mb-4">
                <span className="text-primary-foreground text-sm font-bold">S</span>
              </div>
              <h1 className="font-heading text-2xl font-bold tracking-tight">
                网络兼容性说明
              </h1>
              <p className="text-sm text-muted-foreground mt-2">
                ScholarFlow 服务器部署于中国香港，以下信息适用于中国大陆用户
              </p>
            </div>

            {/* Fully available */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <h2 className="text-sm font-semibold">无需代理 — 完全可用</h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {fullyAvailable.map((item) => (
                  <div key={item.name} className="rounded-md border border-border/60 px-3 py-2">
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                所有 AI 模型调用与学术数据库检索均在服务器端完成，不受本地网络限制。
              </p>
            </div>

            {/* Limited */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <h2 className="text-sm font-semibold">可能受限 — 外部链接跳转</h2>
              </div>
              <div className="space-y-2">
                {limited.map((item) => (
                  <div key={item.name} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{item.tip}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Dismiss */}
            <div className="text-center">
              <Button
                onClick={dismissNotice}
                size="lg"
                className="bg-teal text-teal-foreground hover:bg-teal/90 h-11 px-10 text-base"
              >
                我已知晓
              </Button>
            </div>
          </div>
        </div>
      )}

      <header className="border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto flex h-14 items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-[10px] font-bold">S</span>
            </div>
            <span className="font-heading text-sm font-bold">
              ScholarFlow
            </span>
          </Link>
          <Link href="/projects/new">
            <Button size="sm" className="bg-teal text-teal-foreground hover:bg-teal/90">
              + 新建项目
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        <h1 className="font-heading text-2xl font-bold mb-8">
          我的研究项目
        </h1>

        {loading ? (
          <div className="text-sm text-muted-foreground">加载中...</div>
        ) : (
          <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div key={p.id} className="relative group border border-border/50 rounded-lg p-5 hover:border-teal/30 hover:shadow-sm transition-all duration-200 bg-card">
                <Link href={`/projects/${p.id}`} className="block">
                  <div className="flex items-center justify-between mb-3">
                    {p.domain && (
                      <span className="text-xs text-teal font-medium bg-teal/10 px-2 py-0.5 rounded">
                        {p.domain}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {p._count.papers} 篇文献 · {p._count.ideas} 个想法
                    </span>
                  </div>
                  <h3 className="font-semibold text-base group-hover:text-teal transition-colors">
                    {p.name}
                  </h3>
                  {p.description && (
                    <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">
                      {p.description}
                    </p>
                  )}
                </Link>

                {/* Delete button — top right, visible on hover */}
                <button
                  onClick={(e) => { e.preventDefault(); setConfirmId(p.id); }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-red-500 hover:bg-red-500/10 transition-all"
                  title="删除项目"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}

            <Link href="/projects/new">
              <div className="border border-dashed border-border/50 rounded-lg flex items-center justify-center min-h-[140px] hover:border-teal/40 transition-colors cursor-pointer group">
                <div className="text-center text-muted-foreground group-hover:text-teal transition-colors">
                  <span className="text-2xl block mb-1">+</span>
                  <span className="text-sm">创建新项目</span>
                </div>
              </div>
            </Link>
          </div>

          {/* Delete confirmation dialog */}
          {confirmId && (
            <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
              <div className="bg-background border border-border rounded-lg shadow-lg max-w-sm w-full p-6">
                <h3 className="font-semibold text-base mb-2">确认删除项目</h3>
                <p className="text-sm text-muted-foreground mb-1">
                  删除后，该项目的所有数据将被永久清除，包括：
                </p>
                <ul className="text-sm text-muted-foreground mb-5 list-disc pl-5 space-y-0.5">
                  <li>所有文献记录与 AI 分析结果</li>
                  <li>已上传的 PDF 文件（云端同步删除）</li>
                  <li>对话历史、知识图谱、研究想法等</li>
                </ul>
                <p className="text-sm text-red-500 font-medium mb-5">此操作不可撤销。</p>
                <div className="flex items-center justify-end gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmId(null)}
                    disabled={deleting === confirmId}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    className="bg-red-500 text-white hover:bg-red-600"
                    onClick={() => handleDelete(confirmId)}
                    disabled={deleting === confirmId}
                  >
                    {deleting === confirmId ? "删除中..." : "确认删除"}
                  </Button>
                </div>
              </div>
            </div>
          )}
          </>
        )}
      </main>
    </div>
  );
}
