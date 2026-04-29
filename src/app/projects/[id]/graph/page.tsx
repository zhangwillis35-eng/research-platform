"use client";

import { useState, useEffect } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";
import { KnowledgeGraph } from "@/components/graph/KnowledgeGraph";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";

interface Paper {
  id: string;
  title: string;
  abstract?: string;
  authors: { name: string }[];
  year?: number;
  venue?: string;
  citationCount: number;
  isSelected: boolean;
  fullText?: string | null;
  pdfFileName?: string | null;
}

interface GraphNode {
  id: string;
  type: "IV" | "DV" | "MEDIATOR" | "MODERATOR" | "CONTROL";
  frequency: number;
  aliases?: string[];
  measurementApproaches?: string[];
}

interface Finding {
  paper: number;
  effect: string;
  sample: string;
  method: string;
  year: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: "DIRECT" | "MEDIATION" | "MODERATION";
  direction: "positive" | "negative" | "mixed" | "nonsignificant";
  weight: number;
  papers: number[];
  findings?: Finding[];
  consistency?: string;
  boundaryConditions?: string[];
  evidenceStrength?: string;
}

interface MetaSummary {
  fieldName: string;
  coreFindings: string[];
  theoreticalLandscape: { theory: string; usage: string; paperCount: number }[];
  methodologicalProfile: {
    dominantMethods: string[];
    sampleContexts: string[];
    timeSpan: string;
    totalSampleSize: string;
  };
  researchGaps: { gap: string; evidence: string; importance: string }[];
  emergingTrends: string[];
  researchAgenda: string[];
  maturityAssessment: string;
  maturityRationale: string;
}

type ViewTab = "graph" | "evidence" | "landscape";

const typeLabels: Record<string, string> = {
  IV: "自变量",
  DV: "因变量",
  MEDIATOR: "中介变量",
  MODERATOR: "调节变量",
  CONTROL: "控制变量",
};

const typeColors: Record<string, string> = {
  IV: "bg-green-100 text-green-700",
  DV: "bg-blue-100 text-blue-700",
  MEDIATOR: "bg-amber-100 text-amber-700",
  MODERATOR: "bg-purple-100 text-purple-700",
  CONTROL: "bg-gray-100 text-gray-700",
};

const directionLabels: Record<string, { label: string; color: string }> = {
  positive: { label: "正向 +", color: "text-green-600" },
  negative: { label: "负向 −", color: "text-red-600" },
  mixed: { label: "混合 ±", color: "text-amber-600" },
  nonsignificant: { label: "不显著 n.s.", color: "text-gray-400" },
};

const consistencyLabels: Record<string, { label: string; color: string }> = {
  consistent: { label: "高度一致", color: "bg-green-100 text-green-700" },
  mostly_consistent: { label: "基本一致", color: "bg-emerald-100 text-emerald-700" },
  mixed: { label: "结论分歧", color: "bg-amber-100 text-amber-700" },
  contradictory: { label: "相互矛盾", color: "bg-red-100 text-red-700" },
};

const evidenceLabels: Record<string, { label: string; color: string }> = {
  strong: { label: "强证据", color: "bg-green-600 text-white" },
  moderate: { label: "中等证据", color: "bg-blue-500 text-white" },
  weak: { label: "弱证据", color: "bg-amber-500 text-white" },
  insufficient: { label: "证据不足", color: "bg-gray-400 text-white" },
};

const maturityLabels: Record<string, { label: string; color: string; icon: string }> = {
  emerging: { label: "萌芽期", color: "bg-purple-100 text-purple-700", icon: "🌱" },
  growing: { label: "成长期", color: "bg-blue-100 text-blue-700", icon: "📈" },
  maturing: { label: "成熟期", color: "bg-green-100 text-green-700", icon: "🌳" },
  mature: { label: "高度成熟", color: "bg-teal-100 text-teal-700", icon: "🏛️" },
};

export default function GraphPage() {
  const params = useParams();
  const projectId = params.id as string;

  const NS = `graph-${projectId}`;
  const [provider, setProvider] = usePersistedState<AIProvider>(NS, "provider", "gemini-pro");
  const [papers, setPapers] = usePersistedState<Paper[]>(NS, "papers", []);
  const [analysisEngine, setAnalysisEngine] = usePersistedState<"storm" | "notebooklm">(NS, "analysisEngine", "storm");
  const [notebookId, setNotebookId] = usePersistedState<string>(NS, "notebookId", "");
  const [nodes, setNodes] = usePersistedState<GraphNode[]>(NS, "nodes", []);
  const [edges, setEdges] = usePersistedState<GraphEdge[]>(NS, "edges", []);
  const [metaSummary, setMetaSummary] = usePersistedState<MetaSummary | null>(NS, "metaSummary", null);
  const [landscape, setLandscape] = usePersistedState<string | null>(NS, "landscape", null);
  const [activeTab, setActiveTab] = usePersistedState<ViewTab>(NS, "activeTab", "graph");

  // Transient state
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState("");
  const [papersLoading, setPapersLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const xAbort = useAbort();

  useEffect(() => {
    setPapersLoading(true);
    fetch(`/api/papers?projectId=${projectId}&source=fulltext`)
      .then((r) => r.json())
      .then((d) => setPapers(d.papers ?? []))
      .catch(() => {})
      .finally(() => setPapersLoading(false));
    // Load saved notebook ID
    const saved = localStorage.getItem("notebooklm_notebook_id");
    if (saved) setNotebookId(saved);
  }, [projectId]);

  const activePapers = papers;

  async function handleGenerate() {
    if (activePapers.length === 0) return;

    const signal = xAbort.reset();
    setLoading(true);
    setError(null);
    setNodes([]);
    setEdges([]);
    setMetaSummary(null);
    setLandscape(null);
    setSelectedNode(null);
    setSelectedEdge(null);

    try {
      let externalContext = "";

      // STORM — built-in analysis engine
      if (analysisEngine === "storm") {
        setLoadingPhase("STORM 文献深度分析...");
        try {
          const stormRes = await fetch("/api/integrations/storm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "analyze",
              mode: "variables",
              topic: activePapers[0]?.title?.slice(0, 50) ?? "research topic",
              papers: activePapers.slice(0, 25).map((p) => ({
                title: p.title,
                abstract: p.abstract,
                year: p.year,
                venue: p.venue,
              })),
            }),
            signal,
          });
          if (stormRes.ok) {
            const stormData = await stormRes.json();
            if (stormData.article) externalContext = stormData.article;
          }
        } catch { /* continue */ }
      }

      // NotebookLM — external service
      if (analysisEngine === "notebooklm" && notebookId) {
        setLoadingPhase("NotebookLM 全文深度分析...");
        try {
          const nlmRes = await fetch("/api/integrations/notebooklm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "analyze",
              topic: "变量关系提取与元分析",
              type: "variables",
              notebookId: notebookId,
              paperCount: activePapers.length,
            }),
            signal,
          });
          if (nlmRes.ok) {
            const nlmData = await nlmRes.json();
            if (nlmData.combined) externalContext = nlmData.combined;
          }
        } catch { /* continue */ }
      }

      setLoadingPhase("AI 元分析编码 + 领域全景生成...");

      const paperData = activePapers.slice(0, 25).map((p) => ({
        title: p.title,
        abstract: p.abstract,
        year: p.year,
        venue: p.venue,
        fullText: p.fullText?.slice(0, 5000),
      }));

      const graphRes = await fetch("/api/graph/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ papers: paperData, provider, nlmContext: externalContext }),
        signal,
      });
      if (!graphRes.ok) throw new Error("分析失败");
      const graph = await graphRes.json();

      setNodes(graph.nodes ?? []);
      setEdges(graph.edges ?? []);
      setMetaSummary(graph.metaSummary ?? null);
      setLandscape(graph.landscape ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") { setLoading(false); setLoadingPhase(""); return; }
      setError(String(err));
    } finally {
      setLoading(false);
      setLoadingPhase("");
    }
  }

  const connectedEdges = selectedNode
    ? edges.filter((e) => {
        const src = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
        const tgt = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
        return src === selectedNode.id || tgt === selectedNode.id;
      })
    : [];

  const hasResults = nodes.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            研究领域全景分析
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            元分析式编码 · 变量关系图谱 · 效应一致性评估 · 领域全景报告
          </p>
        </div>
        <AIProviderSelect value={provider} onChange={setProvider} />
      </div>

      {/* Paper source panel */}
      <Card className="border-teal/20 bg-teal/[0.02]">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-teal">数据来源：项目文献库</span>
              {papersLoading ? (
                <Skeleton className="h-5 w-20" />
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  {papers.length} 篇文献{papers.filter((p) => p.isSelected).length > 0 &&
                    ` · ${papers.filter((p) => p.isSelected).length} 篇核心`}
                </Badge>
              )}
            </div>
            <Link href={`/projects/${projectId}/papers/search`}>
              <Button size="sm" variant="outline" className="h-7 text-xs">
                去检索更多文献
              </Button>
            </Link>
          </div>

          {papers.length > 0 && (
            <div className="flex items-center gap-4 text-xs">
              <select
                value={analysisEngine}
                onChange={(e) => setAnalysisEngine(e.target.value as "storm" | "notebooklm")}
                className="h-7 px-2 text-xs border border-input rounded-md bg-background"
              >
                <option value="storm">STORM（内置）</option>
                <option value="notebooklm">NotebookLM（外部）</option>
              </select>
              {analysisEngine === "notebooklm" && (
                <input
                  type="text"
                  placeholder="粘贴 NotebookLM 链接或 ID"
                  value={notebookId}
                  onChange={(e) => {
                    let val = e.target.value.trim();
                    const urlMatch = val.match(/notebook\/([a-f0-9-]+)/);
                    if (urlMatch) val = urlMatch[1];
                    setNotebookId(val);
                    localStorage.setItem("notebooklm_notebook_id", val);
                  }}
                  className="h-7 px-2 text-xs border border-input rounded-md bg-background w-64"
                />
              )}
              <span className="text-muted-foreground ml-auto">
                将分析 {activePapers.length} 篇文献
              </span>
            </div>
          )}

          {papers.length === 0 && !papersLoading && (
            <p className="text-xs text-amber-600">
              暂无已上传原文的文献。请先在「文献库」中上传 PDF 文献。
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={handleGenerate} disabled={loading || activePapers.length === 0} className="bg-teal text-teal-foreground hover:bg-teal/90">
          {loading ? loadingPhase || "分析中..." : "生成领域全景分析"}
        </Button>
        <StopButton show={loading} onClick={xAbort.abort} />
      </div>

      {error && <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">{error}</div>}

      {/* Meta-summary header cards */}
      {metaSummary && (
        <div className="grid sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">领域成熟度</p>
              <div className="mt-1 flex items-center justify-center gap-1.5">
                <span className="text-lg">{maturityLabels[metaSummary.maturityAssessment]?.icon ?? "📊"}</span>
                <Badge className={`text-xs ${maturityLabels[metaSummary.maturityAssessment]?.color ?? "bg-gray-100"}`}>
                  {maturityLabels[metaSummary.maturityAssessment]?.label ?? metaSummary.maturityAssessment}
                </Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">变量 · 关系</p>
              <p className="text-2xl font-bold tabular-nums mt-1 text-teal">{nodes.length} · {edges.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">理论框架</p>
              <p className="text-2xl font-bold tabular-nums mt-1">{metaSummary.theoreticalLandscape?.length ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">研究空白</p>
              <p className="text-2xl font-bold tabular-nums mt-1 text-amber-600">{metaSummary.researchGaps?.length ?? 0}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab navigation */}
      {hasResults && (
        <div className="flex items-center gap-1 border-b border-border/50">
          {([
            { key: "graph" as ViewTab, label: "变量关系图谱" },
            { key: "evidence" as ViewTab, label: "元分析证据表" },
            { key: "landscape" as ViewTab, label: "领域全景报告" },
          ]).map(({ key, label }) => (
            <button
              key={key}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? "border-teal text-teal"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ═══ Tab: Graph ═══ */}
      {hasResults && activeTab === "graph" && (
        <>
          {/* Legend */}
          <div className="flex items-center gap-4 text-xs flex-wrap">
            {Object.entries(typeLabels).map(([key, label]) => (
              <div key={key} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: { IV: "#10b981", DV: "#3b82f6", MEDIATOR: "#f59e0b", MODERATOR: "#8b5cf6", CONTROL: "#6b7280" }[key] }} />
                <span>{label}</span>
              </div>
            ))}
            <Separator orientation="vertical" className="h-4" />
            {Object.entries(directionLabels).map(([key, { label, color }]) => (
              <span key={key} className={`${color}`}>{label}</span>
            ))}
          </div>

          <div className="grid lg:grid-cols-[1fr_320px] gap-4">
            <Card className="min-h-[550px]">
              <div className="w-full h-[550px]">
                <KnowledgeGraph nodes={nodes} edges={edges} onNodeClick={(node) => { setSelectedNode(node); setSelectedEdge(null); }} />
              </div>
            </Card>

            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {/* Node detail */}
              {selectedNode ? (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">节点详情</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="font-semibold text-base">{selectedNode.id}</p>
                      <Badge className={`text-[10px] mt-1 ${typeColors[selectedNode.type]}`}>{typeLabels[selectedNode.type]}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">出现在 {selectedNode.frequency} 篇文献中</p>
                    {selectedNode.aliases && selectedNode.aliases.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1">同义变量：</p>
                        <div className="flex flex-wrap gap-1">{selectedNode.aliases.map((a) => <Badge key={a} variant="outline" className="text-[9px]">{a}</Badge>)}</div>
                      </div>
                    )}
                    {selectedNode.measurementApproaches && selectedNode.measurementApproaches.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1">测量方式：</p>
                        {selectedNode.measurementApproaches.map((m, i) => <p key={i} className="text-[11px] text-muted-foreground">• {m}</p>)}
                      </div>
                    )}
                    {connectedEdges.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1">关联关系（{connectedEdges.length}）：</p>
                        {connectedEdges.map((e, i) => {
                          const src = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
                          const tgt = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
                          const other = src === selectedNode.id ? tgt : src;
                          const dir = directionLabels[e.direction] ?? directionLabels.mixed;
                          return (
                            <div
                              key={i}
                              className="text-xs text-muted-foreground p-1.5 rounded hover:bg-muted/50 cursor-pointer"
                              onClick={() => setSelectedEdge(e)}
                            >
                              → {other}（<span className={dir.color}>{dir.label}</span>，{e.weight}篇，
                              {evidenceLabels[e.evidenceStrength ?? ""]?.label ?? ""}）
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : selectedEdge ? null : (
                <Card><CardContent className="pt-6 text-center text-xs text-muted-foreground">点击图谱中的节点查看详情</CardContent></Card>
              )}

              {/* Edge detail — findings drill-down */}
              {selectedEdge && (
                <Card className="border-teal/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      关系详情
                      <button className="text-[10px] text-muted-foreground hover:text-foreground ml-auto" onClick={() => setSelectedEdge(null)}>✕</button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="secondary">{typeof selectedEdge.source === "string" ? selectedEdge.source : (selectedEdge.source as GraphNode).id}</Badge>
                      <span className={directionLabels[selectedEdge.direction]?.color}>→</span>
                      <Badge variant="secondary">{typeof selectedEdge.target === "string" ? selectedEdge.target : (selectedEdge.target as GraphNode).id}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] ${evidenceLabels[selectedEdge.evidenceStrength ?? ""]?.color ?? "bg-gray-400 text-white"}`}>
                        {evidenceLabels[selectedEdge.evidenceStrength ?? ""]?.label ?? "待评估"}
                      </Badge>
                      {selectedEdge.consistency && (
                        <Badge className={`text-[10px] ${consistencyLabels[selectedEdge.consistency]?.color ?? ""}`}>
                          {consistencyLabels[selectedEdge.consistency]?.label ?? selectedEdge.consistency}
                        </Badge>
                      )}
                    </div>

                    {/* Per-paper findings */}
                    {selectedEdge.findings && selectedEdge.findings.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1.5">逐篇研究发现：</p>
                        <div className="space-y-2">
                          {selectedEdge.findings.map((f, i) => (
                            <div key={i} className="p-2 bg-muted/30 rounded text-[11px] space-y-0.5">
                              <p className="font-medium">[{f.paper}] {f.effect}</p>
                              <p className="text-muted-foreground">{f.sample}</p>
                              <p className="text-muted-foreground">{f.method} · {f.year}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedEdge.boundaryConditions && selectedEdge.boundaryConditions.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1">边界条件：</p>
                        {selectedEdge.boundaryConditions.map((bc, i) => (
                          <p key={i} className="text-[11px] text-muted-foreground">• {bc}</p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Variable list */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">变量列表（{nodes.length}）</CardTitle></CardHeader>
                <CardContent className="space-y-1 max-h-[250px] overflow-y-auto">
                  {nodes.sort((a, b) => b.frequency - a.frequency).map((n) => (
                    <div
                      key={n.id}
                      className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-xs hover:bg-muted/50 ${selectedNode?.id === n.id ? "bg-muted" : ""}`}
                      onClick={() => { setSelectedNode(n); setSelectedEdge(null); }}
                    >
                      <span className="truncate">{n.id}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[9px] text-muted-foreground tabular-nums">{n.frequency}篇</span>
                        <Badge className={`text-[9px] px-1 ${typeColors[n.type]}`}>{typeLabels[n.type]}</Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* ═══ Tab: Evidence Table ═══ */}
      {hasResults && activeTab === "evidence" && (
        <div className="space-y-6">
          {/* Core findings */}
          {metaSummary?.coreFindings && (
            <Card className="border-teal/20 bg-teal/[0.02]">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-teal">核心发现（领域共识）</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {metaSummary.coreFindings.map((f, i) => (
                    <p key={i} className="text-sm text-foreground/85 leading-relaxed">{f}</p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Evidence table */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">关系证据汇总表（类 Vote Counting）</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">自变量</th>
                    <th className="py-2 pr-3 font-medium">因变量</th>
                    <th className="py-2 pr-3 font-medium">类型</th>
                    <th className="py-2 pr-3 font-medium">方向</th>
                    <th className="py-2 pr-3 font-medium">研究数(k)</th>
                    <th className="py-2 pr-3 font-medium">一致性</th>
                    <th className="py-2 pr-3 font-medium">证据强度</th>
                    <th className="py-2 font-medium">代表性效应</th>
                  </tr>
                </thead>
                <tbody>
                  {edges
                    .sort((a, b) => b.weight - a.weight)
                    .map((edge, i) => {
                      const src = typeof edge.source === "string" ? edge.source : (edge.source as GraphNode).id;
                      const tgt = typeof edge.target === "string" ? edge.target : (edge.target as GraphNode).id;
                      const dir = directionLabels[edge.direction] ?? directionLabels.mixed;
                      return (
                        <tr
                          key={i}
                          className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                          onClick={() => { setSelectedEdge(edge); setActiveTab("graph"); }}
                        >
                          <td className="py-2 pr-3 font-medium">{src}</td>
                          <td className="py-2 pr-3 font-medium">{tgt}</td>
                          <td className="py-2 pr-3">
                            <Badge variant="outline" className="text-[9px]">{edge.type}</Badge>
                          </td>
                          <td className={`py-2 pr-3 font-medium ${dir.color}`}>{dir.label}</td>
                          <td className="py-2 pr-3 tabular-nums font-bold">{edge.weight}</td>
                          <td className="py-2 pr-3">
                            {edge.consistency && (
                              <Badge className={`text-[9px] ${consistencyLabels[edge.consistency]?.color ?? ""}`}>
                                {consistencyLabels[edge.consistency]?.label ?? edge.consistency}
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            {edge.evidenceStrength && (
                              <Badge className={`text-[9px] ${evidenceLabels[edge.evidenceStrength]?.color ?? ""}`}>
                                {evidenceLabels[edge.evidenceStrength]?.label ?? edge.evidenceStrength}
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {edge.findings?.[0]?.effect ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Theoretical landscape */}
          {metaSummary?.theoreticalLandscape && metaSummary.theoreticalLandscape.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">理论图景</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {metaSummary.theoreticalLandscape
                  .sort((a, b) => b.paperCount - a.paperCount)
                  .map((t, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm">
                      <span className="text-teal font-bold tabular-nums shrink-0 w-6">{t.paperCount}篇</span>
                      <div>
                        <p className="font-medium">{t.theory}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t.usage}</p>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Methodological profile */}
          {metaSummary?.methodologicalProfile && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">方法论画像</CardTitle></CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-medium mb-1 text-muted-foreground">主要研究方法</p>
                  <div className="flex flex-wrap gap-1">
                    {metaSummary.methodologicalProfile.dominantMethods.map((m) => (
                      <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-medium mb-1 text-muted-foreground">样本来源</p>
                  <div className="flex flex-wrap gap-1">
                    {metaSummary.methodologicalProfile.sampleContexts.map((c) => (
                      <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-medium mb-1 text-muted-foreground">时间跨度</p>
                  <p>{metaSummary.methodologicalProfile.timeSpan}</p>
                </div>
                <div>
                  <p className="font-medium mb-1 text-muted-foreground">总样本量估计</p>
                  <p>{metaSummary.methodologicalProfile.totalSampleSize}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Research gaps */}
          {metaSummary?.researchGaps && metaSummary.researchGaps.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/30">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-700">研究空白</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {metaSummary.researchGaps.map((g, i) => (
                  <div key={i} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[9px] ${g.importance === "high" ? "bg-red-500 text-white" : g.importance === "medium" ? "bg-amber-500 text-white" : "bg-gray-400 text-white"}`}>
                        {g.importance === "high" ? "高优先" : g.importance === "medium" ? "中优先" : "低优先"}
                      </Badge>
                      <p className="font-medium">{g.gap}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 pl-14">{g.evidence}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Emerging trends + agenda */}
          {(metaSummary?.emergingTrends?.length || metaSummary?.researchAgenda?.length) && (
            <div className="grid sm:grid-cols-2 gap-4">
              {metaSummary?.emergingTrends && metaSummary.emergingTrends.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-blue-600">新兴趋势</CardTitle></CardHeader>
                  <CardContent>
                    {metaSummary.emergingTrends.map((t, i) => (
                      <p key={i} className="text-xs text-muted-foreground mb-1">📈 {t}</p>
                    ))}
                  </CardContent>
                </Card>
              )}
              {metaSummary?.researchAgenda && metaSummary.researchAgenda.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-purple-600">未来研究议程</CardTitle></CardHeader>
                  <CardContent>
                    {metaSummary.researchAgenda.map((a, i) => (
                      <p key={i} className="text-xs text-muted-foreground mb-1">→ {a}</p>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ Tab: Landscape ═══ */}
      {hasResults && activeTab === "landscape" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-heading">
                {metaSummary?.fieldName ?? "研究领域"} — 全景分析报告
              </CardTitle>
              <div className="flex items-center gap-2">
                {metaSummary?.maturityAssessment && (
                  <Badge className={`text-xs ${maturityLabels[metaSummary.maturityAssessment]?.color ?? ""}`}>
                    {maturityLabels[metaSummary.maturityAssessment]?.icon} {maturityLabels[metaSummary.maturityAssessment]?.label}
                  </Badge>
                )}
                <Badge variant="secondary" className="text-[10px]">
                  基于 {activePapers.length} 篇文献
                </Badge>
              </div>
            </div>
            {metaSummary?.maturityRationale && (
              <p className="text-xs text-muted-foreground mt-1">{metaSummary.maturityRationale}</p>
            )}
          </CardHeader>
          <Separator />
          <CardContent className="pt-5">
            <div className="text-sm text-foreground/85 leading-[1.85] whitespace-pre-line">
              {landscape ?? "生成中..."}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!hasResults && !loading && (
        <Card className="min-h-[400px] flex items-center justify-center">
          <CardContent className="text-center text-muted-foreground max-w-lg">
            <div className="text-4xl mb-4">🔬</div>
            <p className="font-medium text-lg">研究领域全景分析</p>
            <p className="text-sm mt-3 leading-relaxed">
              基于文献库中的论文，AI 将进行元分析式编码：<br/>
              提取每篇论文的变量关系、效应量、样本信息 → 跨研究综合 →<br/>
              评估效应一致性和证据强度 → 生成领域全景报告
            </p>
            <p className="text-xs mt-4 text-muted-foreground/60">
              推荐使用 Gemini 3.1 Pro 或 Claude Sonnet 4 以获得最佳分析深度
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
