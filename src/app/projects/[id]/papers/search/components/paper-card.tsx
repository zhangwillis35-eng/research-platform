"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type FullTextPanelState,
  type Paper,
  getRelevanceColor,
  getRelevanceLabel,
  rankingColors,
} from "./types";

interface PaperCardProps {
  paper: Paper;
  /** Index of the paper within the displayed (sorted + filtered) list. */
  index: number;
  projectId: string;
  selected: boolean;
  onToggleSelect: () => void;
  relevanceScored: boolean;
  saved: boolean;
  onMarkSaved: (key: string) => void;
  /** Full text panel state for THIS paper (null when closed / other paper). */
  fullTextPanel: FullTextPanelState | null;
  setFullTextPanel: React.Dispatch<React.SetStateAction<FullTextPanelState | null>>;
  citeOpen: boolean;
  citeData: Record<string, string> | null;
  citeLoading: boolean;
  onCiteToggle: () => void;
  onCiteClose: () => void;
  onJumpToChat: () => void;
}

export function PaperCard({
  paper,
  index: i,
  projectId,
  selected,
  onToggleSelect,
  relevanceScored,
  saved,
  onMarkSaved,
  fullTextPanel,
  setFullTextPanel,
  citeOpen,
  citeData,
  citeLoading,
  onCiteToggle,
  onCiteClose,
  onJumpToChat,
}: PaperCardProps) {
  return (
    <div
      id={`paper-${i + 1}`}
      data-paper-index={i}
      className="group border border-border/50 rounded-lg p-4 hover:border-teal/20 transition-all duration-150 bg-card scroll-mt-16"
    >
      {/* Row 1: checkbox + relevance score + title */}
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="accent-teal mt-1.5 shrink-0"
        />
        <button
          className="text-xs text-muted-foreground/60 font-mono mt-1 shrink-0 w-5 text-right hover:text-teal hover:font-bold transition-colors cursor-pointer"
          title="跳回对话"
          onClick={onJumpToChat}
        >{i + 1}</button>
        {/* Relevance score badge */}
        {paper.relevanceScore != null ? (
          <div
            className={`shrink-0 w-10 h-10 rounded-lg border flex flex-col items-center justify-center ${getRelevanceColor(paper.relevanceScore)}`}
            title={paper.relevanceReason || getRelevanceLabel(paper.relevanceScore)}
          >
            <span className="text-sm font-bold leading-none">{paper.relevanceScore}</span>
            <span className="text-[8px] leading-none mt-0.5">{getRelevanceLabel(paper.relevanceScore).slice(0, 2)}</span>
          </div>
        ) : relevanceScored ? (
          <div
            className="shrink-0 w-10 h-10 rounded-lg border border-gray-300 bg-gray-50 flex flex-col items-center justify-center"
            title="评分失败，请重新检索"
          >
            <span className="text-sm font-bold leading-none text-gray-400">?</span>
            <span className="text-[8px] leading-none mt-0.5 text-gray-400">未评</span>
          </div>
        ) : null}
        {/* Full text indicator */}
        {paper.hasFullText ? (
          <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200" title="已获取全文">全文</span>
        ) : paper.abstract && paper.abstract.length > 100 ? (
          <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-medium bg-gray-50 text-gray-500 border border-gray-200" title="仅有摘要">摘要</span>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="font-medium text-[15px] leading-snug group-hover:text-teal transition-colors flex-1">
              {paper.title}
            </h3>
            <a
              href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
              title="在 Google Scholar 中查看（大陆需代理）"
              onClick={(e) => e.stopPropagation()}
            >
              Scholar ⚠
            </a>
          </div>
          {/* Row 2: authors + year + venue */}
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-muted-foreground flex-1">
              {paper.authors.slice(0, 3).map((a) => a.name).join(", ")}
              {paper.authors.length > 3 && " et al."}
              {paper.year && ` (${paper.year})`}
              {paper.venue && ` — ${paper.venue}`}
            </p>
            {(!paper.abstract || paper.abstract.length < 80) && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                {!paper.abstract ? "仅标题" : "摘要不完整"}
              </span>
            )}
          </div>
          {/* AI Analysis — 每篇都显示 */}
          {/* AI Analysis — 每篇论文都必须有 */}
          {paper.relevanceScore != null && (
            <details open className="mt-2 group">
              <summary className="list-none flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
                <span className="transition-transform group-open:rotate-90 text-emerald-600">▶</span>
                <span className="font-medium text-emerald-800">AI 分析</span>
                {paper.relevanceDataSource && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0">
                    基于{paper.relevanceDataSource}
                  </Badge>
                )}
                {paper.relevanceKeyMatch && paper.relevanceKeyMatch.length > 0 && (
                  <span className="flex gap-0.5">
                    {paper.relevanceKeyMatch.map((k) => (
                      <Badge key={k} variant="secondary" className="text-[9px] px-1 py-0">{k}</Badge>
                    ))}
                  </span>
                )}
              </summary>
              <div className="mt-1.5 p-2.5 rounded-md bg-emerald-50/50 border border-emerald-100 space-y-1">
                {paper.relevanceReason && (
                  <p className="text-[11px] text-emerald-700">
                    <span className="font-medium">相关性：</span>{paper.relevanceReason}
                  </p>
                )}
                {paper.relevanceContribution && (
                  <p className="text-[11px] text-emerald-700">
                    <span className="font-medium">贡献：</span>{paper.relevanceContribution}
                  </p>
                )}
                {paper.relevanceMethodology && (
                  <p className="text-[11px] text-emerald-700">
                    <span className="font-medium">方法：</span>{paper.relevanceMethodology}
                  </p>
                )}
                {paper.relevanceInnovation && (
                  <p className="text-[11px] text-emerald-700">
                    <span className="font-medium">创新：</span>{paper.relevanceInnovation}
                  </p>
                )}
              </div>
            </details>
          )}
          {/* Row 3: abstract — collapsible, or missing-abstract prompt */}
          {paper.abstract ? (
            <details className="mt-2 group">
              <summary className="text-xs text-muted-foreground/70 cursor-pointer hover:text-muted-foreground select-none list-none flex items-center gap-1">
                <span className="transition-transform group-open:rotate-90">▶</span>
                <span>摘要</span>
                {paper.abstract.length < 100 && (
                  <span className="text-[9px] text-amber-500 ml-1">（摘要可能不完整）</span>
                )}
              </summary>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                {paper.abstract}
              </p>
            </details>
          ) : (
            <div className="mt-2 flex items-center gap-2 p-2 rounded bg-amber-50/50 border border-amber-200/50 text-[11px] text-amber-700">
              <span>摘要缺失，AI 分析仅基于标题。</span>
              <a
                href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-600 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                前往 Google Scholar 查看全文（需代理）→
              </a>
            </div>
          )}
          {/* Full text panel (expandable per paper) */}
          {fullTextPanel && (
            <div className="mt-3 p-3 bg-muted/50 rounded-lg border border-border/50">
              {fullTextPanel.loading && (
                <p className="text-xs text-muted-foreground animate-pulse">正在获取全文...</p>
              )}
              {fullTextPanel.error && fullTextPanel.error !== "SHOW_PLAYWRIGHT_OPTION" && (
                <p className="text-xs text-red-500">{fullTextPanel.error}</p>
              )}
              {fullTextPanel.error === "SHOW_PLAYWRIGHT_OPTION" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">开放获取渠道未找到全文。可尝试通过浏览器深度获取（需连接校园网或 VPN）：</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-indigo-300 text-indigo-700"
                    onClick={async () => {
                      setFullTextPanel({ paperIndex: i, loading: true });
                      try {
                        const res = await fetch("/api/papers/fulltext", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            doi: paper.doi,
                            openAccessPdf: paper.openAccessPdf,
                            title: paper.title,
                            usePlaywright: true,
                          }),
                        });
                        const data = await res.json();
                        if (data.available) {
                          setFullTextPanel({
                            paperIndex: i,
                            loading: false,
                            text: data.text,
                            source: data.source + " (Playwright)",
                            wordCount: data.wordCount,
                          });
                        } else {
                          setFullTextPanel({
                            paperIndex: i,
                            loading: false,
                            error: "深度获取也未能获得全文（可能需要登录学校 VPN）",
                          });
                        }
                      } catch {
                        setFullTextPanel({ paperIndex: i, loading: false, error: "深度获取失败" });
                      }
                    }}
                  >
                    🔍 深度获取（Playwright 浏览器）
                  </Button>
                </div>
              )}
              {fullTextPanel.text && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-muted-foreground">
                      来源: {fullTextPanel.source === "semantic_scholar" ? "Semantic Scholar" : fullTextPanel.source === "html_scrape" ? "Publisher HTML" : fullTextPanel.source} · {fullTextPanel.wordCount?.toLocaleString()} 词
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 text-[10px] px-1"
                      onClick={() => setFullTextPanel(null)}
                    >
                      收起
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap">
                    {fullTextPanel.text}
                  </p>
                </div>
              )}
            </div>
          )}
          {/* Row 4: actions (left) + badges (right) */}
          <div className="flex items-center justify-between mt-3 gap-2">
            {/* Left: action buttons */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                className={`h-6 text-[11px] px-2 ${saved ? "bg-teal/10 text-teal border-teal/30" : ""}`}
                disabled={saved}
                onClick={async () => {
                  try {
                    const res = await fetch("/api/papers", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        projectId,
                        title: paper.title,
                        abstract: paper.abstract,
                        authors: paper.authors,
                        year: paper.year,
                        venue: paper.venue,
                        citationCount: paper.citationCount,
                        doi: paper.doi,
                        source: paper.source,
                        pdfUrl: paper.openAccessPdf || paper.unpaywallUrl,
                        openAccessPdf: paper.openAccessPdf,
                      }),
                    });
                    if (res.ok) {
                      onMarkSaved(paper.doi || paper.title);
                    } else {
                      const data = await res.json();
                      if (data.details?.includes("Unique constraint")) {
                        onMarkSaved(paper.doi || paper.title);
                      } else {
                        alert("保存失败: " + (data.error || "未知错误"));
                      }
                    }
                  } catch {
                    alert("保存失败，请检查网络");
                  }
                }}
              >
                {saved ? "✓ 已添加" : "添加到文献库"}
              </Button>

              {/* 引用格式 — Google Scholar 风格弹窗，服务端 citation-js 生成 */}
              <div className="relative">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[11px] px-2 text-amber-700"
                  onClick={onCiteToggle}
                >
                  Cite
                </Button>
                {citeOpen && (
                  <div className="absolute left-0 top-7 z-50 w-[520px] bg-white border border-border rounded-lg shadow-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">引用格式</span>
                      <button className="text-muted-foreground hover:text-foreground text-xs" onClick={onCiteClose}>✕</button>
                    </div>
                    {citeLoading ? (
                      <p className="text-xs text-muted-foreground animate-pulse py-4 text-center">正在生成引用...</p>
                    ) : citeData ? (
                      <>
                        {[
                          { key: "apa", label: "APA" },
                          { key: "mla", label: "MLA" },
                          { key: "chicago", label: "Chicago" },
                          { key: "gb-t-7714", label: "GB/T 7714" },
                          { key: "bibtex", label: "BibTeX" },
                        ].map(({ key, label }) => (
                          citeData[key] && (
                            <div
                              key={key}
                              className="flex gap-3 group cursor-pointer hover:bg-muted/50 rounded px-2 py-1.5 -mx-2"
                              onClick={async () => {
                                await navigator.clipboard.writeText(citeData[key].replace(/\*/g, ""));
                                onCiteClose();
                                alert(`${label} 引用已复制到剪贴板`);
                              }}
                            >
                              <span className="text-muted-foreground/70 w-20 shrink-0 text-xs font-medium pt-0.5">{label}</span>
                              <span
                                className="text-xs text-foreground leading-relaxed"
                                dangerouslySetInnerHTML={{
                                  __html: citeData[key]
                                    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
                                    .replace(/\n/g, "<br/>"),
                                }}
                              />
                            </div>
                          )
                        ))}
                        <p className="text-[10px] text-muted-foreground/50 pt-1 border-t border-border/30">点击任意格式复制到剪贴板</p>
                      </>
                    ) : (
                      <p className="text-xs text-red-500 py-4 text-center">引用生成失败，请重试</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Row 5: External links — organized by category */}
            <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-border/30 text-[11px]">
              {/* 文献获取 */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-16 shrink-0 text-[10px]">文献获取</span>
                {(paper.openAccessPdf || paper.unpaywallUrl) && (
                  <a href={paper.openAccessPdf || paper.unpaywallUrl} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline">PDF 下载</a>
                )}
                {paper.doi && (
                  <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:underline">DOI 原文页</a>
                )}
                {!paper.openAccessPdf && !paper.unpaywallUrl && !paper.doi && (
                  <span className="text-muted-foreground/50">无直接获取链接</span>
                )}
              </div>

              {/* 查找全文 — Google Scholar + 知网 */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-16 shrink-0 text-[10px]">查找全文</span>
                <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" title="大陆需代理访问">Google Scholar ⚠</a>
                <a href={`https://kns.cnki.net/kns8s/search?classid=WD0FTY92&korder=SU&kw=${encodeURIComponent(paper.title)}`} target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">知网 CNKI</a>
                {paper.connectedPapersUrl && (
                  <a href={paper.connectedPapersUrl} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">相关论文图谱</a>
                )}
              </div>

              {/* 工具 */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-16 shrink-0 text-[10px]">工具</span>
                <button
                  className="text-purple-600 hover:underline cursor-pointer"
                  onClick={() => {
                    const obsUrl = localStorage.getItem("obsidian_base_url") || "https://127.0.0.1:27124";
                    const apiKey = localStorage.getItem("obsidian_api_key") || "";
                    if (!apiKey) {
                      alert("请先在「设置」页面配置 Obsidian API Key");
                      return;
                    }
                    const filename = paper.title.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
                    const notePath = `ScholarFlow/Papers/${filename}.md`;
                    const content = `---\ntitle: "${paper.title}"\nyear: ${paper.year ?? "unknown"}\nvenue: "${paper.venue ?? ""}"\ndoi: "${paper.doi ?? ""}"\ntags: [paper]\n---\n\n# ${paper.title}\n\n${paper.authors.map((a) => a.name).join(", ")} (${paper.year ?? "N/A"})\n${paper.venue ?? ""}\n\n## 摘要\n${paper.abstract ?? "_No abstract_"}\n`;
                    const hdrs: HeadersInit = { "Content-Type": "text/markdown" };
                    if (apiKey) hdrs["Authorization"] = `Bearer ${apiKey}`;
                    fetch(`${obsUrl}/vault/${encodeURIComponent(notePath)}`, { method: "PUT", headers: hdrs, body: content })
                      .then((r) => { if (r.ok) alert("✅ 已推送到 Obsidian"); else alert("推送失败: HTTP " + r.status); })
                      .catch(() => alert("推送失败，请确认 Obsidian 已打开且 Local REST API 插件已启用"));
                  }}
                >
                  推送到 Obsidian
                </button>
                <button
                  className="text-red-600 hover:underline cursor-pointer"
                  onClick={async () => {
                    const zKey = localStorage.getItem("zotero_api_key");
                    const zUser = localStorage.getItem("zotero_user_id");
                    if (!zKey || !zUser) {
                      alert("请先在「设置」页面配置 Zotero API Key 和 User ID");
                      return;
                    }
                    try {
                      const res = await fetch("/api/integrations/zotero", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "add",
                          apiKey: zKey,
                          userId: zUser,
                          paper: { title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, doi: paper.doi, abstract: paper.abstract },
                        }),
                      });
                      const data = await res.json();
                      if (data.success) alert("✅ 已保存到 Zotero");
                      else alert("保存失败: " + (data.error ?? "未知错误"));
                    } catch {
                      alert("保存失败，请检查网络和 Zotero 配置");
                    }
                  }}
                >
                  保存到 Zotero
                </button>
              </div>
            </div>
            {/* Right: metadata + badges */}
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
              {paper.journalMeta?.impactFactor != null && (
                <span className="text-[10px] font-mono text-teal font-bold whitespace-nowrap">
                  IF {paper.journalMeta.impactFactor.toFixed(1)}
                </span>
              )}
              {paper.journalRanking?.badges?.map((badge) => (
                <Badge
                  key={badge}
                  className={`text-[9px] px-1 py-0 font-bold leading-tight ${rankingColors[badge] ?? "bg-gray-400 text-white"}`}
                >
                  {badge}
                </Badge>
              ))}
              <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                {paper.citationCount.toLocaleString()} 引用
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
