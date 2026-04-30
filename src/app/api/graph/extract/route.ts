import { NextResponse } from "next/server";
import { callAI, setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { concurrentPool } from "@/lib/concurrent-pool";

interface Paper {
  title: string;
  abstract?: string;
  authors?: { name: string }[];
  year?: number;
  venue?: string;
}

interface GraphNode {
  id: string;
  type: string;
  frequency: number;
  aliases: string[];
  measurementApproaches: string[];
}

interface GraphEdgeFinding {
  paper: number;
  effect: string;
  sample: string;
  method: string;
  year: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  direction: string;
  weight: number;
  papers: number[];
  findings: GraphEdgeFinding[];
  consistency: string;
  boundaryConditions: string[];
  evidenceStrength: string;
}

interface SubGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Sub-agent: batch graph extraction ────────────
const GRAPH_SYSTEM = `你是管理学定量元分析(meta-analysis)专家。你的任务是从一组文献中系统性地提取所有变量间因果关系，并进行跨研究综合。

请像做 meta-analysis 编码一样，对每篇论文提取结构化数据。

输出严格 JSON：
{
  "nodes": [
    {
      "id": "变量名(英文)",
      "type": "IV|DV|MEDIATOR|MODERATOR|CONTROL",
      "frequency": 3,
      "aliases": ["同义变量1", "同义变量2"],
      "measurementApproaches": ["问卷Likert量表", "客观指标(ROA)"]
    }
  ],
  "edges": [
    {
      "source": "变量A",
      "target": "变量B",
      "type": "DIRECT|MEDIATION|MODERATION",
      "direction": "positive|negative|mixed|nonsignificant",
      "weight": 2,
      "papers": [1, 3],
      "findings": [
        {
          "paper": 1,
          "effect": "β=0.35, p<0.01",
          "sample": "中国制造业企业 N=320",
          "method": "hierarchical regression",
          "year": 2023
        }
      ],
      "consistency": "consistent|mostly_consistent|mixed|contradictory",
      "boundaryConditions": ["在高不确定性环境中更显著", "仅对大企业成立"],
      "evidenceStrength": "strong|moderate|weak|insufficient"
    }
  ]
}

元分析编码规则：
1. 变量名统一用英文，合并同义变量（如 firm performance / corporate performance → Firm Performance），并记录 aliases
2. 对每条边(关系)：
   - 逐篇提取 findings：效应量(β/r/d)、显著性、样本、方法、年份
   - 判断 consistency：多篇研究结果是否一致
   - 提取 boundaryConditions：在什么条件下关系成立/不成立
   - 评估 evidenceStrength：综合考虑研究数量、方法质量、一致性
3. direction 增加 nonsignificant（不显著），区分于 mixed（有正有负）`;

// ─── Meta-summary agent: synthesize merged graph ─────
const META_SYSTEM = `你是管理学定量元分析专家。基于已合并的变量关系图谱，生成元分析综合摘要。

输出严格 JSON：
{
  "fieldName": "该领域名称(中英文)",
  "coreFindings": [
    "发现1: X对Y有稳健的正向影响(k=5, 一致性高)",
    "发现2: M中介了X与Y的关系(k=3, 部分中介为主)"
  ],
  "theoreticalLandscape": [
    { "theory": "理论名称", "usage": "主要用于解释...", "paperCount": 4 }
  ],
  "methodologicalProfile": {
    "dominantMethods": ["问卷调查", "档案数据"],
    "sampleContexts": ["中国企业", "美国上市公司"],
    "timeSpan": "2018-2025",
    "totalSampleSize": "约12000+"
  },
  "researchGaps": [
    { "gap": "缺乏纵向研究设计", "evidence": "全部8篇均为横截面设计", "importance": "high" }
  ],
  "emergingTrends": ["近年开始关注AI技术的调节作用"],
  "researchAgenda": ["未来方向1: 需要验证...", "未来方向2: 边界条件..."],
  "maturityAssessment": "emerging|growing|maturing|mature",
  "maturityRationale": "该领域处于...阶段，因为..."
}`;

// ─── Landscape narrative agent ──────────
const LANDSCAPE_SYSTEM = `你是管理学领域的资深学者，擅长撰写系统性文献综述中的"研究全景分析"章节。

基于提供的变量关系图谱数据和元分析摘要，撰写一份全面的研究领域全景分析报告。

要求：
1. 用中文学术写作风格
2. 至少 1500 字，结构清晰
3. 必须包含以下板块（每个板块都要写充分）：

一、领域概述与研究脉络
- 该领域的核心研究问题是什么
- 研究是如何随时间演进的
- 目前处于什么发展阶段

二、核心变量关系网络
- 主要的因果路径有哪些（用 → 标注）
- 哪些关系已被多项研究稳健验证
- 哪些关系的发现存在分歧或矛盾
- 中介机制和调节条件的全貌

三、效应一致性与证据强度评估
- 对每个关键关系：支持研究数量、效应方向一致性、证据强度等级
- 类似 vote counting 方法的效应汇总
- 标注哪些结论可以视为"领域共识"，哪些仍有争议

四、理论图景
- 该领域使用了哪些理论视角
- 各理论的解释侧重点
- 理论整合的可能性

五、方法论特征
- 主流研究方法、数据来源
- 方法论偏好是否导致了系统性偏差
- 缺失的方法论视角

六、研究空白与未来议程
- 具体的、可操作的研究空白（不要泛泛而谈）
- 每个空白用证据支撑
- 建议的研究问题或假设

引用时用 [编号] 标注对应文献。`;

// ─── Sub-graph merging logic ─────────────────────

/** Normalize variable name for deduplication */
function normalizeNodeId(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Merge multiple sub-graphs into a unified graph */
function mergeSubGraphs(subGraphs: SubGraph[], paperOffsets: number[]): SubGraph {
  // Merge nodes — deduplicate by normalized ID
  const nodeMap = new Map<string, GraphNode>();

  for (let g = 0; g < subGraphs.length; g++) {
    const sub = subGraphs[g];
    for (const node of sub.nodes) {
      const key = normalizeNodeId(node.id);
      const existing = nodeMap.get(key);
      if (existing) {
        existing.frequency += node.frequency;
        // Merge aliases (deduplicate)
        const aliasSet = new Set([...existing.aliases, ...node.aliases, node.id]);
        aliasSet.delete(existing.id);
        existing.aliases = [...aliasSet];
        // Merge measurement approaches
        const measures = new Set([...existing.measurementApproaches, ...node.measurementApproaches]);
        existing.measurementApproaches = [...measures];
      } else {
        nodeMap.set(key, { ...node });
      }
    }
  }

  // Merge edges — combine edges with same normalized source+target
  const edgeMap = new Map<string, GraphEdge>();

  for (let g = 0; g < subGraphs.length; g++) {
    const sub = subGraphs[g];
    const offset = paperOffsets[g];
    for (const edge of sub.edges) {
      const srcKey = normalizeNodeId(edge.source);
      const tgtKey = normalizeNodeId(edge.target);
      // Resolve to canonical node IDs
      const srcNode = nodeMap.get(srcKey);
      const tgtNode = nodeMap.get(tgtKey);
      const canonSrc = srcNode?.id ?? edge.source;
      const canonTgt = tgtNode?.id ?? edge.target;
      const edgeKey = `${normalizeNodeId(canonSrc)}→${normalizeNodeId(canonTgt)}`;

      // Offset paper references to global indices
      const offsetPapers = edge.papers.map(p => p + offset);
      const offsetFindings = edge.findings.map(f => ({ ...f, paper: f.paper + offset }));

      const existing = edgeMap.get(edgeKey);
      if (existing) {
        existing.weight += edge.weight;
        existing.papers = [...existing.papers, ...offsetPapers];
        existing.findings = [...existing.findings, ...offsetFindings];
        existing.boundaryConditions = [...new Set([...existing.boundaryConditions, ...edge.boundaryConditions])];
        // Re-evaluate consistency across merged findings
        if (existing.direction !== edge.direction) {
          existing.direction = "mixed";
          existing.consistency = "mixed";
        }
      } else {
        edgeMap.set(edgeKey, {
          ...edge,
          source: canonSrc,
          target: canonTgt,
          papers: offsetPapers,
          findings: offsetFindings,
        });
      }
    }
  }

  // Re-evaluate evidence strength based on merged counts
  for (const edge of edgeMap.values()) {
    const k = edge.papers.length;
    if (k >= 5 && edge.consistency !== "contradictory") edge.evidenceStrength = "strong";
    else if (k >= 3) edge.evidenceStrength = "moderate";
    else if (k >= 2) edge.evidenceStrength = "weak";
    else edge.evidenceStrength = "insufficient";
  }

  return {
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
  };
}

// ─── Batch size for parallel sub-agent extraction ─────
const BATCH_SIZE = 8; // Papers per sub-agent (sweet spot for LLM context quality)
const EXTRACTION_CONCURRENCY = 5; // Parallel sub-agent count

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    setAIContext(auth.id, "/api/graph/extract");

    const body = await request.json();
    const { papers, provider = "deepseek-fast", nlmContext = "" } = body as {
      papers: Paper[];
      provider?: AIProvider;
      nlmContext?: string;
    };

    if (!papers?.length) {
      return NextResponse.json({ error: "Papers required" }, { status: 400 });
    }

    // Support up to 50 papers with parallel processing (up from 25)
    const allPapers = papers.slice(0, 50);

    // For small sets (≤8), use direct single-call path (no batching overhead)
    if (allPapers.length <= BATCH_SIZE) {
      return handleDirect(allPapers, provider, nlmContext);
    }

    // For larger sets, use SSE streaming with parallel sub-agents
    return handleParallel(allPapers, provider, nlmContext);
  } catch (error) {
    return NextResponse.json(
      { error: "Graph extraction failed", details: String(error) },
      { status: 500 }
    );
  }
}

/** Direct path for small paper sets — single AI call, no SSE */
async function handleDirect(papers: Paper[], provider: AIProvider, nlmContext: string) {
  const content = formatPapers(papers, 0);
  const fullContent = nlmContext
    ? `${content}\n\n===== NotebookLM 全文分析补充 =====\n${nlmContext}`
    : content;

  // Step 1: Extract graph
  const graphResponse = await callAI({
    provider,
    system: GRAPH_SYSTEM,
    messages: [{ role: "user", content: `以下是 ${papers.length} 篇文献，请进行元分析式编码：\n\n${fullContent}` }],
    jsonMode: true,
    noThinking: true,
    temperature: 0.2,
    maxTokens: 8000,
  });

  let graph;
  try {
    graph = JSON.parse(graphResponse.content);
  } catch {
    return NextResponse.json({ nodes: [], edges: [], raw: graphResponse.content });
  }

  // Step 2: Meta-summary + Landscape in parallel
  const [metaResponse, landscapeResponse] = await Promise.all([
    callAI({
      provider,
      system: META_SYSTEM,
      messages: [{ role: "user", content: `图谱数据：\n${JSON.stringify({ nodes: graph.nodes, edges: graph.edges }, null, 2).slice(0, 6000)}\n\n原始文献共 ${papers.length} 篇。` }],
      jsonMode: true,
      noThinking: true,
      temperature: 0.2,
      maxTokens: 4000,
    }),
    callAI({
      provider,
      system: LANDSCAPE_SYSTEM,
      messages: [{
        role: "user",
        content: `原始文献（共 ${papers.length} 篇）：\n\n${content.slice(0, 6000)}\n\n元分析结果：\n${JSON.stringify({ nodes: graph.nodes?.slice(0, 30), edges: graph.edges?.slice(0, 40) }, null, 2)}\n\n请基于以上信息，撰写研究领域全景分析报告。`,
      }],
      temperature: 0.3,
      maxTokens: 8000,
    }),
  ]);

  let metaSummary;
  try {
    metaSummary = JSON.parse(metaResponse.content);
  } catch {
    metaSummary = {};
  }

  return NextResponse.json({
    ...graph,
    metaSummary,
    landscape: landscapeResponse.content,
  });
}

/** Parallel sub-agent path for larger sets — SSE streaming with progress */
async function handleParallel(papers: Paper[], provider: AIProvider, nlmContext: string) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      // Split papers into batches for parallel sub-agents
      const batches: { papers: Paper[]; offset: number }[] = [];
      for (let i = 0; i < papers.length; i += BATCH_SIZE) {
        batches.push({ papers: papers.slice(i, i + BATCH_SIZE), offset: i });
      }

      send({
        type: "status",
        message: `启动 ${batches.length} 个并行子代理，提取 ${papers.length} 篇文献的知识图谱...`,
        totalBatches: batches.length,
      });

      // Phase 1: Parallel sub-agent graph extraction
      const subGraphs: SubGraph[] = [];
      const paperOffsets: number[] = [];

      await concurrentPool(
        batches,
        async (batch) => {
          const content = formatPapers(batch.papers, batch.offset);
          const batchContent = batch.offset === 0 && nlmContext
            ? `${content}\n\n===== NotebookLM 全文分析补充 =====\n${nlmContext.slice(0, 3000)}`
            : content;

          const response = await callAI({
            provider,
            system: GRAPH_SYSTEM,
            messages: [{
              role: "user",
              content: `以下是第 ${batch.offset + 1}-${batch.offset + batch.papers.length} 篇文献（共 ${papers.length} 篇），请进行元分析式编码：\n\n${batchContent}`,
            }],
            jsonMode: true,
            noThinking: true,
            temperature: 0.2,
            maxTokens: 6000,
          });

          const parsed = JSON.parse(response.content);
          return { graph: parsed as SubGraph, offset: batch.offset };
        },
        EXTRACTION_CONCURRENCY,
        (completed, total, result) => {
          if (result.status === "fulfilled" && result.value) {
            subGraphs.push(result.value.graph);
            paperOffsets.push(result.value.offset);
          }
          send({
            type: "progress",
            phase: "extraction",
            completed,
            total,
            status: result.status === "fulfilled" ? "ok" : "error",
          });
        }
      );

      if (subGraphs.length === 0) {
        send({ type: "error", message: "所有子代理提取失败" });
        controller.close();
        return;
      }

      // Phase 2: Merge sub-graphs
      send({ type: "status", message: `合并 ${subGraphs.length} 个子图谱...` });
      const mergedGraph = mergeSubGraphs(subGraphs, paperOffsets);

      send({
        type: "status",
        message: `合并完成: ${mergedGraph.nodes.length} 个变量节点, ${mergedGraph.edges.length} 条关系边`,
      });

      // Phase 3: Meta-summary + Landscape narrative in parallel
      send({ type: "status", message: "生成元分析综合摘要与全景分析报告..." });

      const allContent = formatPapers(papers, 0);
      const graphSummary = JSON.stringify({
        nodes: mergedGraph.nodes.slice(0, 30),
        edges: mergedGraph.edges.slice(0, 40),
      }, null, 2);

      const [metaResponse, landscapeResponse] = await Promise.all([
        callAI({
          provider,
          system: META_SYSTEM,
          messages: [{
            role: "user",
            content: `以下是合并后的图谱数据（来自 ${papers.length} 篇文献，${subGraphs.length} 个子代理的提取结果）：\n${graphSummary.slice(0, 6000)}\n\n请生成元分析综合摘要。`,
          }],
          jsonMode: true,
          noThinking: true,
          temperature: 0.2,
          maxTokens: 4000,
        }),
        callAI({
          provider,
          system: LANDSCAPE_SYSTEM,
          messages: [{
            role: "user",
            content: `原始文献（共 ${papers.length} 篇）：\n\n${allContent.slice(0, 6000)}\n\n元分析图谱结果：\n${graphSummary}\n\n请基于以上信息，撰写研究领域全景分析报告。`,
          }],
          temperature: 0.3,
          maxTokens: 8000,
        }),
      ]);

      let metaSummary;
      try {
        metaSummary = JSON.parse(metaResponse.content);
      } catch {
        metaSummary = {};
      }

      // Final result
      send({
        type: "done",
        nodes: mergedGraph.nodes,
        edges: mergedGraph.edges,
        metaSummary,
        landscape: landscapeResponse.content,
        stats: {
          totalPapers: papers.length,
          subAgents: batches.length,
          successfulAgents: subGraphs.length,
          totalNodes: mergedGraph.nodes.length,
          totalEdges: mergedGraph.edges.length,
        },
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** Format papers for LLM consumption */
function formatPapers(papers: Paper[], offset: number): string {
  return papers
    .map(
      (p, i) =>
        `[${offset + i + 1}] ${p.title} (${p.year ?? "N/A"})${p.venue ? ` — ${p.venue}` : ""}\n${p.abstract ?? "(无摘要)"}`
    )
    .join("\n\n---\n\n");
}

export const maxDuration = 300;
