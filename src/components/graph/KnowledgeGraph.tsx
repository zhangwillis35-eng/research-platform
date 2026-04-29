"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

interface GraphNode {
  id: string;
  type: "IV" | "DV" | "MEDIATOR" | "MODERATOR" | "CONTROL";
  frequency: number;
  // d3 simulation fields
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
}

const NODE_COLORS: Record<string, string> = {
  IV: "#10b981",       // green
  DV: "#3b82f6",       // blue
  MEDIATOR: "#f59e0b", // amber
  MODERATOR: "#8b5cf6",// purple
  CONTROL: "#6b7280",  // gray
};

const EDGE_COLORS: Record<string, string> = {
  positive: "#10b981",
  negative: "#ef4444",
  mixed: "#f59e0b",
  nonsignificant: "#d1d5db",
};

export function KnowledgeGraph({ nodes, edges, onNodeClick }: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    svg.selectAll("*").remove();

    // Zoom behavior
    const g = svg.append("g");
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 4])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        }) as never
    );

    // Arrow markers
    const defs = svg.append("defs");
    ["positive", "negative", "mixed"].forEach((dir) => {
      defs
        .append("marker")
        .attr("id", `arrow-${dir}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 20)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", EDGE_COLORS[dir]);
    });

    // Force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.id)
          .distance(120)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(40));

    // Edges
    const link = g
      .append("g")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", (d) => EDGE_COLORS[d.direction] ?? "#999")
      .attr("stroke-width", (d) => Math.max(1, Math.min(d.weight * 2, 6)))
      .attr("stroke-opacity", 0.6)
      .attr("marker-end", (d) => `url(#arrow-${d.direction})`);

    // Edge labels
    const edgeLabels = g
      .append("g")
      .selectAll("text")
      .data(edges.filter((e) => e.type !== "DIRECT"))
      .join("text")
      .attr("font-size", "9px")
      .attr("fill", "#666")
      .attr("text-anchor", "middle")
      .text((d) => (d.type === "MEDIATION" ? "Med" : "Mod"));

    // Node groups
    const node = g
      .append("g")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Node circles
    node
      .append("circle")
      .attr("r", (d) => Math.max(8, Math.min(d.frequency * 6, 24)))
      .attr("fill", (d) => NODE_COLORS[d.type] ?? "#999")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .on("mouseover", function (event, d) {
        d3.select(this).attr("stroke", NODE_COLORS[d.type]).attr("stroke-width", 3);
        // Highlight connected edges
        link.attr("stroke-opacity", (l) => {
          const src = typeof l.source === "string" ? l.source : l.source.id;
          const tgt = typeof l.target === "string" ? l.target : l.target.id;
          return src === d.id || tgt === d.id ? 1 : 0.1;
        });
        setTooltip({ x: event.pageX, y: event.pageY, node: d });
      })
      .on("mouseout", function () {
        d3.select(this).attr("stroke", "#fff").attr("stroke-width", 2);
        link.attr("stroke-opacity", 0.6);
        setTooltip(null);
      })
      .on("click", (_, d) => onNodeClick?.(d));

    // Node labels
    node
      .append("text")
      .text((d) => d.id)
      .attr("font-size", "11px")
      .attr("font-weight", "500")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => -(Math.max(8, Math.min(d.frequency * 6, 24)) + 6))
      .attr("fill", "#374151");

    // Tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (typeof d.source === "object" ? d.source.x ?? 0 : 0))
        .attr("y1", (d) => (typeof d.source === "object" ? d.source.y ?? 0 : 0))
        .attr("x2", (d) => (typeof d.target === "object" ? d.target.x ?? 0 : 0))
        .attr("y2", (d) => (typeof d.target === "object" ? d.target.y ?? 0 : 0));

      edgeLabels
        .attr("x", (d) => {
          const sx = typeof d.source === "object" ? d.source.x ?? 0 : 0;
          const tx = typeof d.target === "object" ? d.target.x ?? 0 : 0;
          return (sx + tx) / 2;
        })
        .attr("y", (d) => {
          const sy = typeof d.source === "object" ? d.source.y ?? 0 : 0;
          const ty = typeof d.target === "object" ? d.target.y ?? 0 : 0;
          return (sy + ty) / 2 - 5;
        });

      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, onNodeClick]);

  return (
    <div className="relative w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-card border border-border shadow-lg rounded-lg px-3 py-2 text-xs z-50"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          <p className="font-semibold">{tooltip.node.id}</p>
          <p className="text-muted-foreground">
            类型: {
              { IV: "自变量", DV: "因变量", MEDIATOR: "中介变量", MODERATOR: "调节变量", CONTROL: "控制变量" }[tooltip.node.type]
            }
          </p>
          <p className="text-muted-foreground">出现频率: {tooltip.node.frequency} 篇</p>
        </div>
      )}
    </div>
  );
}
