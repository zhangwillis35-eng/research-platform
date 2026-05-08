/**
 * AI-Researcher style 6-step research idea pipeline.
 *
 * 1. Literature analysis → extract theories, contexts, methods
 * 2. Concept generation → combine dimensions creatively
 * 3. Deduplication → check against existing literature
 * 4. Proposal generation → flesh out each idea
 * 5. Ranking → score by novelty, feasibility, impact
 * 6. Peer review simulation → strength/weakness analysis
 */
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";

export interface ResearchDimensions {
  theories: string[];
  contexts: string[];
  methods: string[];
  gaps: string[];
}

export interface ResearchIdea {
  id: string;
  title: string;
  theory: string;
  context: string;
  method: string;
  hypothesis: string;
  contribution: string;
  scores: {
    novelty: number;
    feasibility: number;
    impact: number;
    overall: number;
  };
  peerReview?: {
    strengths: string[];
    weaknesses: string[];
    questions: string[];
    verdict: "strong_accept" | "accept" | "revise" | "reject";
  };
}

export interface IdeaPipelineResult {
  dimensions: ResearchDimensions;
  ideas: ResearchIdea[];
  provider: string;
}

// Step 1: Extract research dimensions from literature
async function extractDimensions(
  papers: UnifiedPaper[],
  provider: AIProvider,
  engineContext: string = ""
): Promise<ResearchDimensions> {
  const content = papers
    .slice(0, 20)
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title} (${p.year}) ${p.venue ?? ""}${p.journalRanking?.badges?.length ? ` [${p.journalRanking.badges.join("/")}]` : ""}\n${p.abstract ?? ""}`
    )
    .join("\n---\n");

  try {
    const response = await callAI({
      provider,
      system: `You are a management research methodology expert. Extract research dimensions from the provided literature.

Output JSON:
{
  "theories": ["Theory 1: brief description", ...],
  "contexts": ["Context 1: brief description", ...],
  "methods": ["Method 1: brief description", ...],
  "gaps": ["Gap 1: unexplored combination or contradiction", ...]
}

Extract 4-8 items per dimension, at least 3 research gaps. All values MUST be in Chinese (中文). List theories, contexts, and methods separately.`,
      messages: [{ role: "user", content: content + (engineContext ? `\n\n## 深度分析结果\n\n${engineContext}\n\n请结合以上分析来提取更精确的维度。` : "") }],
      jsonMode: true,
      noThinking: true,
      temperature: 0.2,
    });
    const jsonStr = response.content.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    return JSON.parse(jsonStr);
  } catch {
    return { theories: [], contexts: [], methods: [], gaps: [] };
  }
}

// Steps 2-5: Generate, deduplicate, rank ideas
async function generateAndRankIdeas(
  dimensions: ResearchDimensions,
  papers: UnifiedPaper[],
  provider: AIProvider,
  engineContext: string = ""
): Promise<ResearchIdea[]> {
  try {
    const response = await callAI({
      provider,
      system: `You are a management research innovation expert. Based on the provided theory×context×method dimensions and research gaps, generate 5-8 innovative research ideas.

Each idea must be a novel combination of theory, context, and method, prioritizing identified research gaps.

Output JSON (ALL values MUST be in Chinese 中文):
{
  "ideas": [
    {
      "id": "idea-1",
      "title": "研究标题",
      "theory": "所用理论",
      "context": "研究情境",
      "method": "研究方法",
      "hypothesis": "核心假设（1-2句）",
      "contribution": "预期学术贡献（1-2句）",
      "scores": {
        "novelty": 8,
        "feasibility": 7,
        "impact": 8,
        "overall": 7.7
      }
    }
  ]
}

Scoring (1-10):
- novelty: fewer similar studies = higher score
- feasibility: data availability and methodological feasibility
- impact: potential contribution to management theory and practice
- overall: weighted average (novelty×0.4 + feasibility×0.3 + impact×0.3)

Sort by overall score descending.`,
      messages: [
        {
          role: "user",
          content: `维度提取结果：\n${JSON.stringify(dimensions, null, 2)}\n\n参考文献数量：${papers.length} 篇\n顶级期刊（UTD24/FT50）：${papers.filter((p) => p.journalRanking?.utd24 || p.journalRanking?.ft50).length} 篇${engineContext ? `\n\n## 深度分析结果\n\n${engineContext}\n\n请基于以上分析结果，生成更具针对性和创新性的研究想法。` : ""}`,
        },
      ],
      jsonMode: true,
      noThinking: true,
      temperature: 0.7,
      maxTokens: 4096,
    });
    const jsonStr = response.content.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    const parsed = JSON.parse(jsonStr);
    return (parsed.ideas ?? []).sort(
      (a: ResearchIdea, b: ResearchIdea) =>
        b.scores.overall - a.scores.overall
    );
  } catch {
    return [];
  }
}

// Step 6: Peer review simulation
async function simulatePeerReview(
  idea: ResearchIdea,
  provider: AIProvider
): Promise<ResearchIdea["peerReview"]> {
  try {
    const response = await callAI({
      provider,
      system: `You are an anonymous reviewer for a top management journal (AMJ, ASQ, SMJ). Rigorously review the research proposal below.

Output JSON (ALL values MUST be in Chinese 中文):
{
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1", "不足2"],
  "questions": ["需要作者回答的问题1", "问题2"],
  "verdict": "strong_accept/accept/revise/reject"
}

Review criteria: theoretical contribution, methodological rigor, originality, practical significance.`,
      messages: [
        {
          role: "user",
          content: `标题: ${idea.title}\n理论: ${idea.theory}\n情境: ${idea.context}\n方法: ${idea.method}\n假设: ${idea.hypothesis}\n贡献: ${idea.contribution}`,
        },
      ],
      jsonMode: true,
      noThinking: true,
      temperature: 0.3,
      maxTokens: 2048,
    });
    const jsonStr = response.content.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    return JSON.parse(jsonStr);
  } catch {
    return undefined;
  }
}

// Full pipeline
export async function runIdeaPipeline(
  papers: UnifiedPaper[],
  provider: AIProvider = "deepseek-fast",
  withPeerReview: boolean = true,
  topic?: string
): Promise<IdeaPipelineResult> {
  // Step 1: Extract dimensions
  const dimensions = await extractDimensions(papers, provider);

  // Steps 2-5: Generate and rank
  const ideas = await generateAndRankIdeas(dimensions, papers, provider);

  // Step 6: Peer review top 3
  if (withPeerReview && ideas.length > 0) {
    const topIdeas = ideas.slice(0, 3);
    const reviews = await Promise.all(
      topIdeas.map((idea) => simulatePeerReview(idea, provider))
    );
    for (let i = 0; i < topIdeas.length; i++) {
      topIdeas[i].peerReview = reviews[i];
    }
  }

  return { dimensions, ideas, provider };
}
