"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";

interface GraphNode {
  id: string;
  type: "IV" | "DV" | "MEDIATOR" | "MODERATOR" | "CONTROL";
  frequency: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: "DIRECT" | "MEDIATION" | "MODERATION";
  direction: "positive" | "negative" | "mixed" | "nonsignificant";
  weight: number;
  papers: number[];
}

interface KnowledgeGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
}

const NODE_COLORS: Record<string, string> = {
  IV: "#10b981", DV: "#3b82f6", MEDIATOR: "#f59e0b",
  MODERATOR: "#8b5cf6", CONTROL: "#6b7280",
};
const NODE_LABELS: Record<string, string> = {
  IV: "自变量", DV: "因变量", MEDIATOR: "中介变量",
  MODERATOR: "调节变量", CONTROL: "控制变量",
};
const EDGE_COLORS: Record<string, string> = {
  positive: "#10b981", negative: "#ef4444", mixed: "#f59e0b", nonsignificant: "#d1d5db",
};
const ALL_TYPES = ["IV", "DV", "MEDIATOR", "MODERATOR", "CONTROL"] as const;

function nodeRadius(d: GraphNode) {
  return Math.max(8, Math.min(d.frequency * 6, 24));
}

function getNodeId(n: string | GraphNode): string {
  return typeof n === "string" ? n : n.id;
}

function getPos(n: string | GraphNode): { x: number; y: number } {
  if (typeof n === "object") return { x: n.x ?? 0, y: n.y ?? 0 };
  return { x: 0, y: 0 };
}

interface Cluster {
  id: number;
  nodes: GraphNode[];
  label: string;
  color: string;
}

/** Detect connected components via BFS */
function findClusters(nodes: GraphNode[], edges: GraphEdge[]): Cluster[] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    const s = getNodeId(e.source), t = getNodeId(e.target);
    adj.get(s)?.add(t);
    adj.get(t)?.add(s);
  }

  const visited = new Set<string>();
  const clusters: Cluster[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const queue = [n.id];
    const members: GraphNode[] = [];
    visited.add(n.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = nodeMap.get(id);
      if (node) members.push(node);
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }
    // Label = the highest-frequency node in the cluster
    const center = members.sort((a, b) => b.frequency - a.frequency)[0];
    clusters.push({
      id: clusters.length,
      nodes: members,
      label: center?.id ?? `Cluster ${clusters.length + 1}`,
      color: NODE_COLORS[center?.type ?? "IV"],
    });
  }

  return clusters.sort((a, b) => b.nodes.length - a.nodes.length);
}

export function KnowledgeGraph({ nodes, edges, onNodeClick, onEdgeClick }: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const minimapRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node?: GraphNode; edge?: GraphEdge } | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<"force" | "radial">("force");
  const [selectedEdgeIdx, setSelectedEdgeIdx] = useState<number | null>(null);
  const [activeCluster, setActiveCluster] = useState<number | null>(null);
  const transformRef = useRef(d3.zoomIdentity);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zoomRef = useRef<any>(null);

  function zoomToCluster(cluster: Cluster) {
    if (!svgRef.current || cluster.nodes.length === 0) return;
    setActiveCluster(cluster.id);

    const xs = cluster.nodes.map((n) => n.x ?? 0);
    const ys = cluster.nodes.map((n) => n.y ?? 0);
    const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60;
    const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60;
    const w = maxX - minX, h = maxY - minY;

    const svg = d3.select(svgRef.current);
    const svgW = svgRef.current.clientWidth;
    const svgH = svgRef.current.clientHeight;
    const scale = Math.min(svgW / w, svgH / h, 2) * 0.85;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const tx = svgW / 2 - cx * scale, ty = svgH / 2 - cy * scale;

    const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
    if (zoomRef.current) {
      svg.transition().duration(600).call(zoomRef.current.transform, transform);
    }
  }

  function zoomToFit() {
    if (!svgRef.current || nodes.length === 0) return;
    setActiveCluster(null);
    const svg = d3.select(svgRef.current);
    if (zoomRef.current) {
      svg.transition().duration(600).call(zoomRef.current.transform, d3.zoomIdentity);
    }
  }

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }, []);

  // Count nodes per type
  const typeCounts: Record<string, number> = {};
  for (const n of nodes) typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;

  const visibleNodes = nodes.filter((n) => !hiddenTypes.has(n.type));
  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges.filter(
    (e) => visibleNodeIds.has(getNodeId(e.source)) && visibleNodeIds.has(getNodeId(e.target))
  );
  const clusters = findClusters(visibleNodes, visibleEdges);

  useEffect(() => {
    if (!svgRef.current || visibleNodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    svg.selectAll("*").remove();

    const defs = svg.append("defs");

    // Grid pattern
    const grid = defs.append("pattern").attr("id", "grid").attr("width", 30).attr("height", 30).attr("patternUnits", "userSpaceOnUse");
    grid.append("circle").attr("cx", 15).attr("cy", 15).attr("r", 0.8).attr("fill", "#e5e7eb");

    // Glow filter
    const glow = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glow.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
    glow.append("feComposite").attr("in", "SourceGraphic").attr("in2", "blur").attr("operator", "over");

    // Radial gradients per type
    for (const [type, color] of Object.entries(NODE_COLORS)) {
      const rg = defs.append("radialGradient").attr("id", `grad-${type}`);
      rg.append("stop").attr("offset", "0%").attr("stop-color", d3.color(color)!.brighter(0.6).formatHex());
      rg.append("stop").attr("offset", "100%").attr("stop-color", color);
    }

    // Edge gradients
    visibleEdges.forEach((e, i) => {
      const sc = NODE_COLORS[typeof e.source === "object" ? e.source.type : "IV"] ?? "#999";
      const tc = NODE_COLORS[typeof e.target === "object" ? e.target.type : "DV"] ?? "#999";
      const lg = defs.append("linearGradient").attr("id", `edge-grad-${i}`).attr("gradientUnits", "userSpaceOnUse");
      lg.append("stop").attr("offset", "0%").attr("stop-color", sc);
      lg.append("stop").attr("offset", "100%").attr("stop-color", tc);
    });

    // Background
    svg.append("rect").attr("width", width).attr("height", height).attr("fill", "url(#grid)");

    const g = svg.append("g");
    if (transformRef.current !== d3.zoomIdentity) g.attr("transform", transformRef.current.toString());

    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 4]).on("zoom", (event) => {
      g.attr("transform", event.transform);
      transformRef.current = event.transform;
      updateMinimap();
    });
    svg.call(zoomBehavior as never);
    zoomRef.current = zoomBehavior;

    // Simulation
    const simulation = d3.forceSimulation<GraphNode>(visibleNodes);
    if (layout === "radial") {
      const dvNodes = visibleNodes.filter((n) => n.type === "DV");
      const cx = width / 2, cy = height / 2;
      dvNodes.forEach((n) => { n.fx = cx; n.fy = cy; });
      simulation
        .force("link", d3.forceLink<GraphNode, GraphEdge>(visibleEdges).id((d) => d.id).distance(160))
        .force("charge", d3.forceManyBody().strength(-400))
        .force("radial", d3.forceRadial<GraphNode>(180, cx, cy).strength((d) => (d.type === "DV" ? 0 : 0.8)))
        .force("collision", d3.forceCollide().radius(45));
    } else {
      simulation
        .force("link", d3.forceLink<GraphNode, GraphEdge>(visibleEdges).id((d) => d.id).distance(120))
        .force("charge", d3.forceManyBody().strength(-300))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(40));
    }

    // Edges as curved paths
    const linkG = g.append("g");
    const link = linkG.selectAll<SVGPathElement, GraphEdge>("path")
      .data(visibleEdges).join("path")
      .attr("fill", "none")
      .attr("stroke", (_, i) => `url(#edge-grad-${i})`)
      .attr("stroke-width", (d) => Math.max(1.5, Math.min(d.weight * 2, 8)))
      .attr("stroke-opacity", (_, i) => (selectedEdgeIdx !== null && selectedEdgeIdx !== i ? 0.15 : 0.6))
      .attr("stroke-dasharray", (d) => (d.direction === "nonsignificant" ? "6,4" : null))
      .attr("cursor", "pointer")
      .on("mouseover", (event, d) => {
        setTooltip({ x: event.pageX, y: event.pageY, edge: d });
      })
      .on("mouseout", () => setTooltip(null))
      .on("click", (_, d) => {
        const idx = visibleEdges.indexOf(d);
        setSelectedEdgeIdx((prev) => (prev === idx ? null : idx));
        onEdgeClick?.(d);
      });

    // Animate dashes for nonsignificant
    link.filter((d) => d.direction === "nonsignificant")
      .attr("stroke-dashoffset", 0)
      .each(function () {
        const el = d3.select(this);
        function animateDash() {
          el.transition().duration(1500).ease(d3.easeLinear)
            .attr("stroke-dashoffset", -20)
            .on("end", () => { el.attr("stroke-dashoffset", 0); animateDash(); });
        }
        animateDash();
      });

    // Edge labels
    const edgeLabels = g.append("g").selectAll("text")
      .data(visibleEdges.filter((e) => e.type !== "DIRECT")).join("text")
      .attr("font-size", "9px").attr("fill", "#666").attr("text-anchor", "middle")
      .text((d) => (d.type === "MEDIATION" ? "Med" : "Mod"));

    // Node groups
    const node = g.append("g").selectAll<SVGGElement, GraphNode>("g")
      .data(visibleNodes).join("g").attr("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => { if (!event.active) simulation.alphaTarget(0); if (layout !== "radial" || d.type !== "DV") { d.fx = null; d.fy = null; } })
      );

    // Frequency ring (arc behind node)
    const maxFreq = Math.max(...visibleNodes.map((n) => n.frequency), 1);
    node.each(function (d) {
      const r = nodeRadius(d);
      const ratio = Math.min(d.frequency / maxFreq, 1);
      const arc = d3.arc<unknown>().innerRadius(r + 2).outerRadius(r + 5).startAngle(0).endAngle(ratio * 2 * Math.PI);
      d3.select(this).append("path").attr("d", arc({} as never)).attr("fill", NODE_COLORS[d.type]).attr("opacity", 0.4);
    });

    // Circles with gradient + glow
    node.append("circle")
      .attr("r", (d) => nodeRadius(d))
      .attr("fill", (d) => `url(#grad-${d.type})`)
      .attr("stroke", "#fff").attr("stroke-width", 2)
      .attr("filter", "url(#glow)")
      .style("transition", "transform 0.2s ease")
      .on("mouseover", function (event, d) {
        d3.select(this).attr("stroke", NODE_COLORS[d.type]).attr("stroke-width", 3)
          .transition().duration(200).attr("r", nodeRadius(d) * 1.15);
        link.attr("stroke-opacity", (l) => {
          const src = getNodeId(l.source), tgt = getNodeId(l.target);
          return src === d.id || tgt === d.id ? 1 : 0.1;
        });
        setTooltip({ x: event.pageX, y: event.pageY, node: d });
      })
      .on("mouseout", function (_, d) {
        d3.select(this).attr("stroke", "#fff").attr("stroke-width", 2)
          .transition().duration(200).attr("r", nodeRadius(d));
        link.attr("stroke-opacity", 0.6);
        setTooltip(null);
      })
      .on("click", (_, d) => onNodeClick?.(d));

    // Label backgrounds + text
    node.each(function (d) {
      const sel = d3.select(this);
      const r = nodeRadius(d);
      const text = sel.append("text").text(d.id).attr("font-size", "11px").attr("font-weight", "500")
        .attr("text-anchor", "middle").attr("dy", -(r + 8)).attr("fill", "#374151");
      // Measure text and add bg pill
      const bbox = (text.node() as SVGTextElement)?.getBBox();
      if (bbox) {
        sel.insert("rect", "text:last-of-type")
          .attr("x", bbox.x - 4).attr("y", bbox.y - 2)
          .attr("width", bbox.width + 8).attr("height", bbox.height + 4)
          .attr("rx", 6).attr("fill", "white").attr("fill-opacity", 0.75);
      }
    });

    // Curved edge path builder
    function edgePath(d: GraphEdge): string {
      const s = getPos(d.source), t = getPos(d.target);
      const dx = t.x - s.x, dy = t.y - s.y;
      const dr = Math.sqrt(dx * dx + dy * dy) * 0.6;
      return `M${s.x},${s.y} A${dr},${dr} 0 0,1 ${t.x},${t.y}`;
    }

    // Minimap
    function updateMinimap() {
      if (!minimapRef.current) return;
      const mm = d3.select(minimapRef.current);
      mm.selectAll("*").remove();
      const scale = 0.12;
      const mmG = mm.append("g").attr("transform", `scale(${scale})`);
      // Draw nodes
      visibleNodes.forEach((n) => {
        mmG.append("circle").attr("cx", n.x ?? 0).attr("cy", n.y ?? 0)
          .attr("r", 6).attr("fill", NODE_COLORS[n.type]);
      });
      // Draw edges
      visibleEdges.forEach((e) => {
        const s = getPos(e.source), t = getPos(e.target);
        mmG.append("line").attr("x1", s.x).attr("y1", s.y).attr("x2", t.x).attr("y2", t.y)
          .attr("stroke", "#aaa").attr("stroke-width", 2);
      });
      // Viewport rect
      const tf = transformRef.current;
      const vx = -tf.x / tf.k, vy = -tf.y / tf.k;
      const vw = width / tf.k, vh = height / tf.k;
      mmG.append("rect").attr("x", vx).attr("y", vy).attr("width", vw).attr("height", vh)
        .attr("fill", "none").attr("stroke", "#3b82f6").attr("stroke-width", 8);
    }

    simulation.on("tick", () => {
      link.attr("d", edgePath);
      edgeLabels.attr("x", (d) => { const s = getPos(d.source), t = getPos(d.target); return (s.x + t.x) / 2; })
        .attr("y", (d) => { const s = getPos(d.source), t = getPos(d.target); return (s.y + t.y) / 2 - 8; });
      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

      // Update edge gradients
      visibleEdges.forEach((e, i) => {
        const s = getPos(e.source), t = getPos(e.target);
        defs.select(`#edge-grad-${i}`).attr("x1", s.x).attr("y1", s.y).attr("x2", t.x).attr("y2", t.y);
      });

      updateMinimap();
    });

    return () => { simulation.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleNodes, visibleEdges, onNodeClick, onEdgeClick, layout, selectedEdgeIdx]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-muted-foreground text-sm">
        暂无知识图谱数据
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* Type filter toggles */}
      <div className="absolute top-2 left-2 z-10 flex flex-wrap gap-1.5">
        {ALL_TYPES.map((t) => (
          <button key={t} onClick={() => toggleType(t)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-all"
            style={{
              backgroundColor: hiddenTypes.has(t) ? "#f3f4f6" : NODE_COLORS[t] + "20",
              borderColor: hiddenTypes.has(t) ? "#d1d5db" : NODE_COLORS[t],
              color: hiddenTypes.has(t) ? "#9ca3af" : NODE_COLORS[t],
              opacity: hiddenTypes.has(t) ? 0.6 : 1,
            }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hiddenTypes.has(t) ? "#d1d5db" : NODE_COLORS[t] }} />
            {NODE_LABELS[t]}
            {typeCounts[t] ? <span className="ml-0.5 opacity-70">{typeCounts[t]}</span> : null}
          </button>
        ))}
        {/* Layout toggle */}
        <button onClick={() => setLayout((l) => (l === "force" ? "radial" : "force"))}
          className="px-2 py-0.5 rounded-full text-xs font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
          {layout === "force" ? "Force" : "Radial"}
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-10 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-2 text-xs space-y-1">
        <div className="font-semibold text-gray-700 mb-1">图例</div>
        {ALL_TYPES.map((t) => (
          <div key={t} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: NODE_COLORS[t] }} />
            <span className="text-gray-600">{NODE_LABELS[t]}</span>
            {typeCounts[t] ? <span className="text-gray-400 ml-auto">{typeCounts[t]}</span> : null}
          </div>
        ))}
        <div className="border-t border-gray-100 pt-1 mt-1">
          {(["positive", "negative", "mixed", "nonsignificant"] as const).map((d) => (
            <div key={d} className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: EDGE_COLORS[d], borderStyle: d === "nonsignificant" ? "dashed" : undefined }} />
              <span className="text-gray-600">{{ positive: "正向", negative: "负向", mixed: "混合", nonsignificant: "不显著" }[d]}</span>
            </div>
          ))}
        </div>
      </div>

      <svg ref={svgRef} className="w-full h-full" />

      {/* Cluster navigation panel */}
      {clusters.length > 1 && (
        <div className="absolute top-2 right-2 z-10 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-2 max-h-[60%] overflow-y-auto w-44">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-gray-700">子图导航（{clusters.length}）</span>
            <button onClick={zoomToFit} className="text-[9px] text-blue-500 hover:text-blue-700">全览</button>
          </div>
          {clusters.map((c) => (
            <button
              key={c.id}
              onClick={() => zoomToCluster(c)}
              className={`w-full text-left px-2 py-1.5 rounded text-[10px] mb-0.5 flex items-center gap-1.5 transition-colors ${
                activeCluster === c.id ? "bg-blue-50 border border-blue-300" : "hover:bg-gray-50 border border-transparent"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
              <span className="truncate font-medium text-gray-700">{c.label}</span>
              <span className="ml-auto text-gray-400 shrink-0">{c.nodes.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Minimap */}
      <div className="absolute bottom-2 right-2 z-10 border border-gray-300 rounded bg-white/80 backdrop-blur-sm overflow-hidden">
        <svg ref={minimapRef} width={120} height={80} />
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="absolute pointer-events-none bg-card border border-border shadow-lg rounded-lg px-3 py-2 text-xs z-50"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}>
          {tooltip.node && (
            <>
              <p className="font-semibold">{tooltip.node.id}</p>
              <p className="text-muted-foreground">类型: {NODE_LABELS[tooltip.node.type]}</p>
              <p className="text-muted-foreground">出现频率: {tooltip.node.frequency} 篇</p>
            </>
          )}
          {tooltip.edge && (
            <>
              <p className="font-semibold">{getNodeId(tooltip.edge.source)} → {getNodeId(tooltip.edge.target)}</p>
              <p className="text-muted-foreground">类型: {tooltip.edge.type}</p>
              <p className="text-muted-foreground">方向: {{ positive: "正向", negative: "负向", mixed: "混合", nonsignificant: "不显著" }[tooltip.edge.direction]}</p>
              <p className="text-muted-foreground">文献数: {tooltip.edge.papers.length} 篇</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
