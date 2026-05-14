/**
 * AI-Researcher style research idea pipeline.
 *
 * Optimized pipeline (single LLM call for dimensions + ideas):
 * 1. extractAndGenerateIdeas → dimensions + ideas in ONE call (saves ~10s vs sequential)
 * 2. simulatePeerReview × 2 (top 2 only, parallel-ready)
 *
 * Streaming version: runIdeaPipelineStream (async generator)
 * Legacy blocking version: runIdeaPipeline (kept for compatibility)
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

export type IdeaStreamEvent =
  | { phase: "ideas"; dimensions: ResearchDimensions; ideas: ResearchIdea[] }
  | { phase: "review"; ideaId: string; review: ResearchIdea["peerReview"] }
  | { phase: "done" }
  | { phase: "error"; error: string };

// Combined Step 1+2: Extract dimensions AND generate ideas in a single LLM call
async function extractAndGenerateIdeas(
  papers: UnifiedPaper[],
  provider: AIProvider,
  engineContext: string = ""
): Promise<{ dimensions: ResearchDimensions; ideas: ResearchIdea[] }> {
  const content = papers
    .slice(0, 20)
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title} (${p.year ?? "N/A"}) ${p.venue ?? ""}${p.journalRanking?.badges?.length ? ` [${p.journalRanking.badges.join("/")}]` : ""}\n${p.abstract ?? ""}`
    )
    .join("\n---\n");

  try {
    const response = await callAI({
      provider,
      system: `You are a management research expert. Analyze the provided literature and generate innovative research ideas in a single pass.

First extract research dimensions, then immediately use them to generate 5-8 novel research ideas.

Output JSON (ALL values MUST be in Chinese 中文):
{
  "dimensions": {
    "theories": ["理论1：简要描述", ...],
    "contexts": ["情境1：简要描述", ...],
    "methods": ["方法1：简要描述", ...],
    "gaps": ["研究空白1：未探索的组合或矛盾", ...]
  },
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

Rules:
- Dimensions: 4-8 items per category, at least 3 research gaps
- Each idea must be a novel theory × context × method combination, prioritizing identified gaps
- Scoring (1-10): novelty (fewer similar studies = higher), feasibility (data availability), impact (theory/practice contribution)
- overall = novelty×0.4 + feasibility×0.3 + impact×0.3
- Sort ideas by overall score descending`,
      messages: [
        {
          role: "user",
          content:
            content +
            (engineContext
              ? `\n\n## 深度分析结果\n\n${engineContext}\n\n请结合以上分析来提取更精确的维度并生成更具针对性的研究想法。`
              : ""),
        },
      ],
      jsonMode: true,
      noThinking: true,
      temperature: 0.5,
      maxTokens: 6000,
    });
    const jsonStr = response.content
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(jsonStr);
    const ideas = (parsed.ideas ?? []).sort(
      (a: ResearchIdea, b: ResearchIdea) => b.scores.overall - a.scores.overall
    );
    return {
      dimensions: parsed.dimensions ?? {
        theories: [],
        contexts: [],
        methods: [],
        gaps: [],
      },
      ideas,
    };
  } catch {
    return {
      dimensions: { theories: [], contexts: [], methods: [], gaps: [] },
      ideas: [],
    };
  }
}

// Step 3: Peer review simulation
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
    const jsonStr = response.content
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    return JSON.parse(jsonStr);
  } catch {
    return undefined;
  }
}

// Streaming pipeline — yields events so frontend can show ideas immediately
export async function* runIdeaPipelineStream(
  papers: UnifiedPaper[],
  provider: AIProvider = "deepseek-fast",
  withPeerReview: boolean = true,
  engineContext: string = ""
): AsyncGenerator<IdeaStreamEvent> {
  // Single combined call → dimensions + ideas
  const { dimensions, ideas } = await extractAndGenerateIdeas(
    papers,
    provider,
    engineContext
  );

  // Emit ideas immediately — user sees results without waiting for peer review
  yield { phase: "ideas", dimensions, ideas };

  // Peer review top 2 in PARALLEL (saves 2-4s vs sequential)
  if (withPeerReview && ideas.length > 0) {
    const topIdeas = ideas.slice(0, 2);
    const reviews = await Promise.all(
      topIdeas.map(idea => simulatePeerReview(idea, provider).then(review => ({ idea, review })))
    );
    for (const { idea, review } of reviews) {
      if (review) {
        yield { phase: "review", ideaId: idea.id, review };
      }
    }
  }

  yield { phase: "done" };
}

// Legacy blocking pipeline — kept for compatibility
export async function runIdeaPipeline(
  papers: UnifiedPaper[],
  provider: AIProvider = "deepseek-fast",
  withPeerReview: boolean = true,
  _topic?: string
): Promise<IdeaPipelineResult> {
  const { dimensions, ideas } = await extractAndGenerateIdeas(papers, provider);

  if (withPeerReview && ideas.length > 0) {
    const topIdeas = ideas.slice(0, 2);
    const reviews = await Promise.all(
      topIdeas.map((idea) => simulatePeerReview(idea, provider))
    );
    for (let i = 0; i < topIdeas.length; i++) {
      topIdeas[i].peerReview = reviews[i];
    }
  }

  return { dimensions, ideas, provider };
}
