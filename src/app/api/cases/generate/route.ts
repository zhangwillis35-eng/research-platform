import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { callAI, setAIContext } from "@/lib/ai";

// POST /api/cases/generate — generate research questions from selected cases + knowledge graph
export async function POST(request: Request) {
  const { projectId, storyIds, topic } = await request.json();

  if (!projectId || !Array.isArray(storyIds) || storyIds.length === 0) {
    return NextResponse.json(
      { error: "projectId and non-empty storyIds array are required" },
      { status: 400 }
    );
  }

  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return NextResponse.json(
      { error: "请先输入研究方向或话题" },
      { status: 400 }
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
      { status: 404 }
    );
  }

  // Fetch knowledge graph context
  const [graphNodes, graphEdges] = await Promise.all([
    prisma.graphNode.findMany({
      where: { projectId },
      orderBy: { frequency: "desc" },
      take: 30,
      select: { label: true, nodeType: true, frequency: true },
    }),
    prisma.graphEdge.findMany({
      where: { projectId },
      orderBy: { weight: "desc" },
      take: 30,
      select: {
        fromNode: { select: { label: true } },
        toNode: { select: { label: true } },
        relationType: true,
        direction: true,
        weight: true,
      },
    }),
  ]);

  // Build case summaries for the prompt
  const caseSummaries = stories
    .map(
      (s, i) =>
        `Case ${i + 1} [${s.obCategory ?? "unknown"}]:\n` +
        `Summary: ${s.academicSummary ?? "N/A"}\n` +
        `Key phenomena: ${JSON.stringify(s.keyPhenomena ?? [])}\n` +
        `Theory tags: ${JSON.stringify(s.theoryTags ?? [])}`
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
          `${e.fromNode.label} → ${e.toNode.label} [${e.relationType}, ${e.direction ?? "unspecified"}, w=${e.weight}]`
      )
      .join("; ");
    graphContext =
      `\n\nKnowledge Graph Context:\n` +
      `Key constructs: ${nodeStr}\n` +
      `Key relationships: ${edgeStr}`;
  }

  const systemPrompt =
    `You are a senior organizational behavior scholar specializing in bridging practitioner observations and academic theory. ` +
    `Generate research questions that are novel, theoretically grounded, and publishable in top-tier OB journals (AMJ, ASQ, JAP, OBHDP).\n\n` +
    `Return a JSON array of 3-5 research idea objects. Each object must have:\n` +
    `- "title": concise title for the research idea\n` +
    `- "researchQuestion": the core research question\n` +
    `- "hypotheses": array of 2-4 testable hypotheses\n` +
    `- "theoreticalBasis": which theories ground this inquiry and why\n` +
    `- "methodology": suggested research design (e.g., field experiment, longitudinal survey, qualitative induction)\n` +
    `- "caseLink": how practitioner cases inspired or inform this question\n` +
    `- "novelty": what makes this question new compared to existing literature\n\n` +
    `Return ONLY the JSON array, no markdown fences.`;

  const userPrompt =
    `The researcher's stated research direction/topic: "${topic.trim()}"\n\n` +
    `Below are practitioner cases and (optionally) a knowledge graph from the researcher's project. ` +
    `Generate research ideas that are aligned with the researcher's topic and bridge these real-world observations with academic theory.\n\n` +
    `${caseSummaries}${graphContext}`;

  const res = await callAI({
    provider: "deepseek-fast",
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
    temperature: 0.5,
    jsonMode: true,
    noThinking: true,
    timeoutMs: 60000,
  });

  let ideas;
  try {
    ideas = JSON.parse(res.content);
  } catch {
    return NextResponse.json(
      { error: "Failed to parse AI response", raw: res.content },
      { status: 500 }
    );
  }

  return NextResponse.json({ ideas, usage: res.usage });
}
