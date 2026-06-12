import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { callAI, setAIContext } from "@/lib/ai";
import { buildFilteredTheoryReference } from "@/lib/ob-knowledge-base";

export const maxDuration = 300;

// POST /api/cases/generate — streaming idea generation from cases + knowledge graph
export async function POST(request: Request) {
  const { projectId, storyIds, topic } = await request.json();

  if (!projectId || !Array.isArray(storyIds) || storyIds.length === 0) {
    return NextResponse.json(
      { error: "projectId and non-empty storyIds array are required" },
      { status: 400 },
    );
  }

  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return NextResponse.json(
      { error: "请先输入研究方向或话题" },
      { status: 400 },
    );
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  setAIContext(auth.id, "cases-generate");

  // Fetch selected stories
  const stories = await prisma.story.findMany({
    where: { id: { in: storyIds }, status: "PUBLISHED" },
    select: {
      anonymizedContent: true,
      academicSummary: true,
      keyPhenomena: true,
      theoryTags: true,
      obCategory: true,
    },
  });

  if (stories.length === 0) {
    return NextResponse.json(
      { error: "No published stories found for the given IDs" },
      { status: 404 },
    );
  }

  // Fetch knowledge graph context
  const [graphNodes, graphEdges] = await Promise.all([
    prisma.graphNode.findMany({
      where: { projectId },
      orderBy: { frequency: "desc" },
      take: 15,
      select: { label: true, nodeType: true, frequency: true },
    }),
    prisma.graphEdge.findMany({
      where: { projectId },
      orderBy: { weight: "desc" },
      take: 15,
      select: {
        fromNode: { select: { label: true } },
        toNode: { select: { label: true } },
        relationType: true,
        direction: true,
        weight: true,
      },
    }),
  ]);

  // Build case summaries
  const caseSummaries = stories
    .map(
      (s, i) =>
        `Case ${i + 1} [${s.obCategory ?? "unknown"}]:\n` +
        `Summary: ${s.academicSummary ?? "N/A"}\n` +
        `Key phenomena: ${JSON.stringify(s.keyPhenomena ?? [])}\n` +
        `Theory tags: ${JSON.stringify(s.theoryTags ?? [])}`,
    )
    .join("\n\n");

  // Build graph context
  let graphContext = "";
  if (graphNodes.length > 0) {
    const nodeStr = graphNodes
      .map((n) => `${n.label} (${n.nodeType}, freq=${n.frequency})`)
      .join("; ");
    const edgeStr = graphEdges
      .map(
        (e) =>
          `${e.fromNode.label} → ${e.toNode.label} [${e.relationType}, ${e.direction ?? "unspecified"}, w=${e.weight}]`,
      )
      .join("; ");
    graphContext =
      `\n\nKnowledge Graph Context:\n` +
      `Key constructs: ${nodeStr}\n` +
      `Key relationships: ${edgeStr}`;
  }

  const theoryRef = buildFilteredTheoryReference(topic);

  // SSE streaming pipeline
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          /* closed */
        }
      }, 10000);

      try {
        // Step 1: Extract dimensions + generate ideas (single LLM call)
        const ideaRes = await callAI({
          provider: "deepseek-fast",
          signal: request.signal,
          system:
            `You are a senior organizational behavior scholar. Analyze the practitioner cases below and generate novel research ideas.\n\n` +
            `OB Theory Knowledge Base:\n${theoryRef}\n\n` +
            `Output JSON (ALL values MUST be in Chinese 中文):\n` +
            `{\n` +
            `  "dimensions": {\n` +
            `    "theories": ["理论1：简要描述", ...],\n` +
            `    "contexts": ["情境1：简要描述", ...],\n` +
            `    "methods": ["方法1：简要描述", ...],\n` +
            `    "gaps": ["研究空白1：未探索的组合或矛盾", ...]\n` +
            `  },\n` +
            `  "ideas": [\n` +
            `    {\n` +
            `      "id": "idea-1",\n` +
            `      "title": "研究标题",\n` +
            `      "theory": "所用理论（含奠基作者）",\n` +
            `      "context": "研究情境",\n` +
            `      "method": "研究方法",\n` +
            `      "hypothesis": "核心假设（1-2句，引用具体理论构念）",\n` +
            `      "contribution": "预期学术贡献（1-2句）",\n` +
            `      "scores": { "novelty": 8, "feasibility": 7, "impact": 8, "overall": 7.7 }\n` +
            `    }\n` +
            `  ]\n` +
            `}\n\n` +
            `Rules:\n` +
            `- Dimensions: 3-5 items per category, at least 2 research gaps\n` +
            `- Generate 3-5 ideas as novel theory × context × method combinations\n` +
            `- Scoring (1-10): novelty (fewer similar studies = higher), feasibility (data availability), impact (theory/practice contribution)\n` +
            `- overall = novelty×0.4 + feasibility×0.3 + impact×0.3\n` +
            `- Sort ideas by overall score descending\n` +
            `- Each idea must reference specific constructs from the theory knowledge base`,
          messages: [
            {
              role: "user",
              content:
                `Researcher's topic: "${topic.trim()}"\n\n` +
                `Practitioner cases:\n${caseSummaries}${graphContext}`,
            },
          ],
          jsonMode: true,
          noThinking: true,
          temperature: 0.5,
          maxTokens: 4000,
        });

        const parsed = JSON.parse(
          ideaRes.content
            .replace(/^```(?:json)?\s*/m, "")
            .replace(/\s*```\s*$/m, "")
            .trim(),
        );

        const dimensions = parsed.dimensions ?? {
          theories: [],
          contexts: [],
          methods: [],
          gaps: [],
        };
        const ideas = (parsed.ideas ?? []).sort(
          (a: { scores: { overall: number } }, b: { scores: { overall: number } }) =>
            b.scores.overall - a.scores.overall,
        );

        // Emit ideas immediately
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ phase: "ideas", dimensions, ideas })}\n\n`,
          ),
        );

        // Step 2: Peer review top 1 idea only (speed optimization)
        const topIdeas = ideas.slice(0, 1);
        if (topIdeas.length > 0) {
          const reviews = await Promise.all(
            topIdeas.map(async (idea: { id: string; title: string; theory: string; context: string; method: string; hypothesis: string; contribution: string }) => {
              try {
                const reviewRes = await callAI({
                  provider: "deepseek-fast",
                  signal: request.signal,
                  system:
                    `You are an anonymous reviewer for a top management journal (AMJ, ASQ, JAP). Rigorously review the research proposal.\n\n` +
                    `Output JSON (ALL values MUST be in Chinese 中文):\n` +
                    `{ "strengths": ["优点1", ...], "weaknesses": ["不足1", ...], "questions": ["问题1", ...], "verdict": "strong_accept/accept/revise/reject" }`,
                  messages: [
                    {
                      role: "user",
                      content: `标题: ${idea.title}\n理论: ${idea.theory}\n情境: ${idea.context}\n方法: ${idea.method}\n假设: ${idea.hypothesis}\n贡献: ${idea.contribution}`,
                    },
                  ],
                  jsonMode: true,
                  noThinking: true,
                  temperature: 0.3,
                  maxTokens: 1024,
                });
                return {
                  ideaId: idea.id,
                  review: JSON.parse(
                    reviewRes.content
                      .replace(/^```(?:json)?\s*/m, "")
                      .replace(/\s*```\s*$/m, "")
                      .trim(),
                  ),
                };
              } catch {
                return null;
              }
            }),
          );

          for (const r of reviews) {
            if (r) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ phase: "review", ideaId: r.ideaId, review: r.review })}\n\n`,
                ),
              );
            }
          }
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ phase: "done" })}\n\n`),
        );
      } catch (err) {
        console.error("[cases/generate] Pipeline error:", err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ phase: "error", error: String(err) })}\n\n`,
          ),
        );
      } finally {
        clearInterval(keepalive);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
