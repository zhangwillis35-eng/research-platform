"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";
import { KnowledgeGraph } from "@/components/graph/KnowledgeGraph";

interface GraphNode {
  id: string;
  type: "IV" | "DV" | "MEDIATOR" | "MODERATOR" | "CONTROL";
  frequency: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: "DIRECT" | "MEDIATION" | "MODERATION";
  direction: "positive" | "negative" | "mixed";
  weight: number;
  papers: number[];
}

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

export default function GraphPage() {
  const [topic, setTopic] = useState("");
  const [provider, setProvider] = useState<AIProvider>("gemini");
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;

    setLoading(true);
    setError(null);
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);

    try {
      // Step 1: Deep search for papers
      const searchRes = await fetch("/api/research/deep-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, provider }),
      });
      if (!searchRes.ok) throw new Error("文献检索失败");
      const { papers } = await searchRes.json();

      if (!papers.length) {
        setError("未找到相关文献");
        setLoading(false);
        return;
      }

      // Step 2: Extract variable graph
      const graphRes = await fetch("/api/graph/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ papers, provider }),
      });
      if (!graphRes.ok) throw new Error("图谱提取失败");
      const graph = await graphRes.json();

      setNodes(graph.nodes ?? []);
      setEdges(graph.edges ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const connectedEdges = selectedNode
    ? edges.filter((e) => {
        const src = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
        const tgt = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
        return src === selectedNode.id || tgt === selectedNode.id;
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-serif-sc)] text-2xl font-bold">
            变量关系知识图谱
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            从文献中提取变量关系，D3 力导向图可视化
          </p>
        </div>
        <AIProviderSelect value={provider} onChange={setProvider} />
      </div>

      <form onSubmit={handleGenerate} className="flex gap-3">
        <Input
          placeholder="输入研究主题，如：servant leadership employee creativity"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={loading}
          className="bg-teal text-teal-foreground hover:bg-teal/90"
        >
          {loading ? "生成中..." : "生成图谱"}
        </Button>
      </form>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Legend */}
      {nodes.length > 0 && (
        <div className="flex items-center gap-4 text-xs">
          {Object.entries(typeLabels).map(([key, label]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor:
                    { IV: "#10b981", DV: "#3b82f6", MEDIATOR: "#f59e0b", MODERATOR: "#8b5cf6", CONTROL: "#6b7280" }[key],
                }}
              />
              <span>{label}</span>
            </div>
          ))}
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 bg-green-500" />
            <span>正向</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 bg-red-500" />
            <span>负向</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 bg-amber-500" />
            <span>混合</span>
          </div>
          <span className="text-muted-foreground ml-2">
            {nodes.length} 节点 · {edges.length} 关系
          </span>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_280px] gap-4">
        {/* Graph */}
        <Card className={`${nodes.length > 0 ? "min-h-[550px]" : "min-h-[400px]"}`}>
          {nodes.length > 0 ? (
            <div className="w-full h-[550px]">
              <KnowledgeGraph
                nodes={nodes}
                edges={edges}
                onNodeClick={(node) => setSelectedNode(node)}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <CardContent className="text-center text-muted-foreground">
                <div className="text-4xl mb-4">🕸️</div>
                <p className="font-medium">输入研究主题，自动提取变量关系图谱</p>
                <p className="text-sm mt-2">
                  支持拖拽节点、缩放、悬停高亮关联路径
                </p>
              </CardContent>
            </div>
          )}
        </Card>

        {/* Side panel */}
        {nodes.length > 0 && (
          <div className="space-y-4">
            {/* Selected node detail */}
            {selectedNode ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">节点详情</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="font-semibold text-base">{selectedNode.id}</p>
                    <Badge className={`text-[10px] mt-1 ${typeColors[selectedNode.type]}`}>
                      {typeLabels[selectedNode.type]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    出现在 {selectedNode.frequency} 篇文献中
                  </p>
                  {connectedEdges.length > 0 && (
                    <div>
                      <p className="text-xs font-medium mb-1">关联关系：</p>
                      {connectedEdges.map((e, i) => {
                        const src = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
                        const tgt = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
                        const other = src === selectedNode.id ? tgt : src;
                        return (
                          <p key={i} className="text-xs text-muted-foreground">
                            → {other}（{e.direction === "positive" ? "正向" : e.direction === "negative" ? "负向" : "混合"}，{e.weight} 篇支持）
                          </p>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-xs text-muted-foreground">
                  点击图谱中的节点查看详情
                </CardContent>
              </Card>
            )}

            {/* Node list */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">变量列表</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[300px] overflow-y-auto">
                {nodes
                  .sort((a, b) => b.frequency - a.frequency)
                  .map((n) => (
                    <div
                      key={n.id}
                      className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-xs hover:bg-muted/50 ${
                        selectedNode?.id === n.id ? "bg-muted" : ""
                      }`}
                      onClick={() => setSelectedNode(n)}
                    >
                      <span className="truncate">{n.id}</span>
                      <Badge className={`text-[9px] px-1 ${typeColors[n.type]}`}>
                        {typeLabels[n.type]}
                      </Badge>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
