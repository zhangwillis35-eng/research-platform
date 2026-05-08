import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { callAI, setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import type { GraphNode, GraphEdge } from "@/generated/prisma/client";

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  setAIContext(auth.id, "/api/graph/query");

  const { projectId, question, provider = "deepseek-fast" } = await request.json();

  if (!projectId || !question) {
    return NextResponse.json(
      { error: "projectId and question required" },
      { status: 400 },
    );
  }

  // Step 1: Fetch all graph nodes and edges for this project
  const [nodes, edges] = await Promise.all([
    prisma.graphNode.findMany({
      where: { projectId },
      select: { id: true, label: true, nodeType: true, frequency: true },
    }),
    prisma.graphEdge.findMany({
      where: { projectId },
      include: { fromNode: true, toNode: true },
    }),
  ]);

  if (nodes.length === 0) {
    return NextResponse.json(
      { error: "No knowledge graph data. Generate the graph first." },
      { status: 404 },
    );
  }

  // Step 2: Build a structured context from graph data
  const graphContext = buildGraphContext(nodes, edges);

  // Step 3: Use LLM to answer the question based on graph evidence
  const systemPrompt = `You are a management research expert. Answer the user's question based ONLY on the knowledge graph evidence provided below.

The knowledge graph was extracted from academic papers and contains:
- Variables (IV, DV, Mediator, Moderator, Control) and their relationships
- Effect directions (positive/negative/mixed/nonsignificant)
- Supporting evidence (paper counts, frequency of appearance)

RULES:
- Only cite relationships that exist in the graph data
- Mention specific effect directions when available
- If the graph doesn't contain relevant information, say so
- Answer in Chinese, use academic language
- Reference variable names exactly as they appear in the graph

KNOWLEDGE GRAPH DATA:
${graphContext}`;

  const response = await callAI({
    provider: provider as AIProvider,
    system: systemPrompt,
    messages: [{ role: "user", content: question }],
    noThinking: true,

    temperature: 0.3,
  });

  return NextResponse.json({
    answer: response.content,
    graphStats: { nodes: nodes.length, edges: edges.length },
    provider: response.provider,
  });
}

type NodeSubset = Pick<GraphNode, "id" | "label" | "nodeType" | "frequency">;

type EdgeWithNodes = GraphEdge & {
  fromNode: GraphNode;
  toNode: GraphNode;
};

function buildGraphContext(
  nodes: NodeSubset[],
  edges: EdgeWithNodes[],
): string {
  // Format nodes by type
  const typeLabels: Record<string, string> = {
    INDEPENDENT_VAR: "自变量",
    DEPENDENT_VAR: "因变量",
    MEDIATOR: "中介变量",
    MODERATOR: "调节变量",
    CONTROL_VAR: "控制变量",
  };

  const byType: Record<string, string[]> = {};
  for (const n of nodes) {
    const type = n.nodeType as string;
    if (!byType[type]) byType[type] = [];
    byType[type].push(`${n.label} (频率: ${n.frequency})`);
  }

  let context = "## Variables\n";
  for (const [type, vars] of Object.entries(byType)) {
    const label = typeLabels[type] ?? type;
    context += `- ${label}: ${vars.join(", ")}\n`;
  }

  const relationLabels: Record<string, string> = {
    DIRECT_EFFECT: "直接效应",
    MEDIATION: "中介效应",
    MODERATION: "调节效应",
  };

  const directionSymbols: Record<string, string> = {
    positive: "+",
    negative: "\u2212",
    mixed: "\u00b1",
    nonsignificant: "n.s.",
  };

  context += "\n## Relationships\n";
  for (const e of edges) {
    const dir =
      directionSymbols[(e.direction as string) ?? ""] ?? "?";
    const relLabel = relationLabels[e.relationType] ?? e.relationType;
    const fromLabel = e.fromNode.label;
    const toLabel = e.toNode.label;
    const paperCount =
      Array.isArray(e.supportPapers)
        ? (e.supportPapers as unknown[]).length
        : 0;
    context += `- ${fromLabel} \u2192 ${toLabel} (${relLabel}, ${dir}, 权重: ${e.weight}, 支撑论文数: ${paperCount})\n`;
  }

  return context;
}

export const maxDuration = 60;
