"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  Handle,
  Position,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";
import { usePersistedState } from "@/hooks/use-persisted-state";

// ─── Custom Node Component ──────────────────────

const nodeColors: Record<string, { bg: string; border: string; text: string }> = {
  iv: { bg: "bg-emerald-50", border: "border-emerald-400", text: "text-emerald-800" },
  dv: { bg: "bg-blue-50", border: "border-blue-400", text: "text-blue-800" },
  mediator: { bg: "bg-amber-50", border: "border-amber-400", text: "text-amber-800" },
  moderator: { bg: "bg-purple-50", border: "border-purple-400", text: "text-purple-800" },
  control: { bg: "bg-gray-50", border: "border-gray-300", text: "text-gray-600" },
};

const nodeLabels: Record<string, string> = {
  iv: "自变量 (IV)",
  dv: "因变量 (DV)",
  mediator: "中介变量 (Med)",
  moderator: "调节变量 (Mod)",
  control: "控制变量",
};

function VariableNode({ data }: { data: { label: string; varType: string } }) {
  const colors = nodeColors[data.varType] ?? nodeColors.control;
  return (
    <div
      className={`px-4 py-2.5 rounded-lg border-2 ${colors.bg} ${colors.border} shadow-sm min-w-[120px] text-center`}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-2 !h-2" />
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-2 !h-2" />
      <p className={`text-xs font-medium ${colors.text}`}>{data.label}</p>
      <p className="text-[9px] text-muted-foreground mt-0.5">
        {nodeLabels[data.varType] ?? data.varType}
      </p>
    </div>
  );
}

const nodeTypes: NodeTypes = { variable: VariableNode };

// ─── Main Page ──────────────────────────────────

const INITIAL_NODES: Node[] = [
  {
    id: "iv1",
    type: "variable",
    position: { x: 50, y: 150 },
    data: { label: "自变量", varType: "iv" },
  },
  {
    id: "dv1",
    type: "variable",
    position: { x: 500, y: 150 },
    data: { label: "因变量", varType: "dv" },
  },
];

const INITIAL_EDGES: Edge[] = [
  {
    id: "e1",
    source: "iv1",
    target: "dv1",
    label: "H1 (+)",
    type: "default",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 2 },
    labelStyle: { fontSize: 11, fontWeight: 600, fill: "#0d9488" },
    labelBgStyle: { fill: "#f0fdfa", stroke: "#99f6e4", strokeWidth: 1 },
    labelBgPadding: [6, 3] as [number, number],
  },
];

export default function ConceptualModelPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [aiProvider, setAiProvider] = usePersistedState<AIProvider>(`model-${projectId}`, "aiProvider", "gemini-pro");
  const [generating, setGenerating] = useState(false);
  const [hypothesisCount, setHypothesisCount] = useState(2);
  const [analysisEngine, setAnalysisEngine] = useState<"storm" | "notebooklm">("storm");
  const [papers, setPapers] = useState<{ id: string; title: string; abstract?: string; authors: { name: string }[]; year?: number; venue?: string; citationCount: number; isSelected: boolean; fullText?: string | null; pdfFileName?: string | null }[]>([]);
  const [paperCount, setPaperCount] = useState(0);
  const reactFlowRef = useRef<HTMLDivElement>(null);
  const xAbort = useAbort();

  // Load papers with full text on mount
  useEffect(() => {
    fetch(`/api/papers?projectId=${projectId}&source=fulltext`)
      .then((r) => r.json())
      .then((d) => {
        const loadedPapers = d.papers ?? [];
        setPapers(loadedPapers);
        setPaperCount(loadedPapers.length);
      })
      .catch(() => {});
  }, [projectId]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const hNum = hypothesisCount;
      setHypothesisCount((c) => c + 1);
      const newEdge: Edge = {
        ...connection,
        id: `e-${Date.now()}`,
        label: `H${hNum} (+)`,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 2 },
        labelStyle: { fontSize: 11, fontWeight: 600, fill: "#0d9488" },
        labelBgStyle: { fill: "#f0fdfa", stroke: "#99f6e4", strokeWidth: 1 },
        labelBgPadding: [6, 3] as [number, number],
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges, hypothesisCount]
  );

  function addNode(varType: string) {
    const id = `${varType}-${Date.now()}`;
    const label =
      varType === "iv"
        ? "新自变量"
        : varType === "dv"
          ? "新因变量"
          : varType === "mediator"
            ? "中介变量"
            : varType === "moderator"
              ? "调节变量"
              : "控制变量";
    const x = varType === "iv" ? 50 : varType === "dv" ? 500 : 275;
    const y = 50 + nodes.length * 80;

    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "variable",
        position: { x, y },
        data: { label, varType },
      },
    ]);
  }

  // AI auto-generate model from topic
  async function generateFromAI() {
    const signal = xAbort.reset();
    setGenerating(true);
    try {
      // Optional: external engine analysis
      let engineInsights = "";
      if (analysisEngine === "storm") {
        try {
          const stormRes = await fetch("/api/integrations/storm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "analyze",
              topic: "概念模型变量关系",
              papers: papers.map((p) => ({ title: p.title, abstract: p.abstract })),
            }),
            signal,
          });
          if (stormRes.ok) {
            const stormData = await stormRes.json();
            if (stormData.combined) engineInsights = "\n\n[STORM 分析结果]\n" + stormData.combined;
          }
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") throw err;
          /* continue without STORM */
        }
      }
      if (analysisEngine === "notebooklm") {
        const notebookId = localStorage.getItem("notebooklm_notebook_id") || "";
        if (notebookId) {
          try {
            const nlmRes = await fetch("/api/integrations/notebooklm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "analyze",
                topic: "概念模型变量关系",
                type: "variables",
                notebookId,
              }),
              signal,
            });
            if (nlmRes.ok) {
              const nlmData = await nlmRes.json();
              if (nlmData.combined) engineInsights = "\n\n[NotebookLM 全文分析结果]\n" + nlmData.combined;
            }
          } catch (err) {
            if (err instanceof Error && err.name === "AbortError") throw err;
            /* continue without NLM */
          }
        }
      }

      const paperContext = papers
        .slice(0, 10)
        .map(
          (p, i) =>
            `[${i + 1}] ${p.title}\n${p.abstract ?? ""}${p.fullText ? "\n[全文摘要] " + p.fullText.slice(0, 5000) : ""}`
        )
        .join("\n\n") + engineInsights;

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: aiProvider,
          type: "variables",
          content: `基于以下文献，提取概念模型中的变量关系。输出严格JSON：
{
  "variables": [
    {"name": "AI washing", "type": "iv"},
    {"name": "投资者信任", "type": "mediator"},
    {"name": "企业估值", "type": "dv"},
    {"name": "信息透明度", "type": "moderator"}
  ],
  "hypotheses": [
    {"from": "AI washing", "to": "投资者信任", "label": "H1 (-)", "direction": "negative"},
    {"from": "投资者信任", "to": "企业估值", "label": "H2 (+)", "direction": "positive"},
    {"from": "信息透明度", "to": "投资者信任", "label": "H3 (Mod)", "direction": "moderation"}
  ]
}

文献：
${paperContext || "（无文献，请基于常见管理学变量关系生成示例）"}`,
        }),
        signal,
      });

      if (!res.ok) throw new Error("AI analysis failed");
      const data = await res.json();
      let result = data.result;
      if (typeof result === "string") {
        // Try to extract JSON from string
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) result = JSON.parse(jsonMatch[0]);
      }

      if (result?.variables && result?.hypotheses) {
        const typePositions: Record<string, { x: number; count: number }> = {
          iv: { x: 50, count: 0 },
          dv: { x: 550, count: 0 },
          mediator: { x: 300, count: 0 },
          moderator: { x: 300, count: 0 },
          control: { x: 50, count: 0 },
        };

        const newNodes: Node[] = result.variables.map(
          (v: { name: string; type: string }) => {
            const pos = typePositions[v.type] ?? typePositions.control;
            const y = 80 + pos.count * 100;
            pos.count++;
            // Offset moderators to the right
            const x = v.type === "moderator" ? pos.x + 200 : pos.x;
            return {
              id: v.name,
              type: "variable",
              position: { x, y },
              data: { label: v.name, varType: v.type },
            };
          }
        );

        const newEdges: Edge[] = result.hypotheses.map(
          (h: { from: string; to: string; label: string }, i: number) => ({
            id: `h-${i}`,
            source: h.from,
            target: h.to,
            label: h.label,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: {
              strokeWidth: 2,
              strokeDasharray: h.label.includes("Mod") ? "5,5" : undefined,
            },
            labelStyle: { fontSize: 11, fontWeight: 600, fill: "#0d9488" },
            labelBgStyle: { fill: "#f0fdfa", stroke: "#99f6e4", strokeWidth: 1 },
            labelBgPadding: [6, 3] as [number, number],
          })
        );

        setNodes(newNodes);
        setEdges(newEdges);
        setHypothesisCount(newEdges.length + 1);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") { setGenerating(false); return; }
      alert("AI 生成失败: " + String(err));
    } finally {
      setGenerating(false);
    }
  }

  // Edit node label on double-click
  function onNodeDoubleClick(_: React.MouseEvent, node: Node) {
    const newLabel = prompt("变量名称:", node.data.label as string);
    if (newLabel !== null) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id ? { ...n, data: { ...n.data, label: newLabel } } : n
        )
      );
    }
  }

  // Edit edge label on double-click
  function onEdgeDoubleClick(_: React.MouseEvent, edge: Edge) {
    const newLabel = prompt("假设标签 (如 H1 (+)):", edge.label as string);
    if (newLabel !== null) {
      setEdges((eds) =>
        eds.map((e) => (e.id === edge.id ? { ...e, label: newLabel } : e))
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            概念模型构建
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            拖拽变量 · 连线假设 · AI 自动生成 · 双击编辑标签
          </p>
        </div>
        <AIProviderSelect value={aiProvider} onChange={setAiProvider} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1">添加变量:</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          onClick={() => addNode("iv")}
        >
          + 自变量 (IV)
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
          onClick={() => addNode("dv")}
        >
          + 因变量 (DV)
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
          onClick={() => addNode("mediator")}
        >
          + 中介变量
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
          onClick={() => addNode("moderator")}
        >
          + 调节变量
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => addNode("control")}
        >
          + 控制变量
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        <Button
          size="sm"
          className="h-7 text-xs bg-teal text-teal-foreground hover:bg-teal/90"
          onClick={generateFromAI}
          disabled={generating}
        >
          {generating ? "AI 生成中..." : "AI 自动生成模型"}
        </Button>
        <StopButton show={generating} onClick={xAbort.abort} />

        <select
          value={analysisEngine}
          onChange={(e) => setAnalysisEngine(e.target.value as "storm" | "notebooklm")}
          className="h-7 px-2 text-xs border border-input rounded-md bg-background"
        >
          <option value="storm">STORM（内置）</option>
          <option value="notebooklm">NotebookLM（外部）</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            文献库 {paperCount} 篇 · {nodes.length} 变量 · {edges.length} 假设
          </Badge>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={reactFlowRef}
        className="border border-border rounded-lg overflow-hidden"
        style={{ height: "calc(100vh - 260px)" }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
          defaultEdgeOptions={{
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2 },
          }}
        >
          <Controls position="bottom-right" />
          <MiniMap
            nodeColor={(n) => {
              const type = n.data?.varType as string;
              if (type === "iv") return "#10b981";
              if (type === "dv") return "#3b82f6";
              if (type === "mediator") return "#f59e0b";
              if (type === "moderator") return "#8b5cf6";
              return "#9ca3af";
            }}
            className="!bg-background !border-border"
          />
          <Background variant={BackgroundVariant.Dots} gap={15} size={1} color="#e5e7eb" />
        </ReactFlow>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span>图例:</span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-emerald-200 border border-emerald-400" />
          自变量
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-blue-200 border border-blue-400" />
          因变量
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-amber-200 border border-amber-400" />
          中介变量
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-purple-200 border border-purple-400" />
          调节变量
        </span>
        <span className="ml-4">操作: 拖拽移动 · 从节点圆点拉线创建假设 · 双击编辑名称</span>
      </div>
    </div>
  );
}
