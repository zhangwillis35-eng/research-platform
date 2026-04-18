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
  provider: AIProvider
): Promise<ResearchDimensions> {
  const content = papers
    .slice(0, 20)
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title} (${p.year}) ${p.venue ?? ""}${p.journalRanking?.badges?.length ? ` [${p.journalRanking.badges.join("/")}]` : ""}\n${p.abstract ?? ""}`
    )
    .join("\n---\n");

  const response = await callAI({
    provider,
    system: `你是管理学研究方法论专家。从文献中提取三个维度和研究空白。

输出 JSON：
{
  "theories": ["理论1: 简述", "理论2: 简述", ...],
  "contexts": ["情境1: 简述", "情境2: 简述", ...],
  "methods": ["方法1: 简述", "方法2: 简述", ...],
  "gaps": ["空白1: 未被研究的组合或矛盾", ...]
}

每个维度提取 4-8 项，研究空白至少 3 个。理论、情境、方法各自独立列出。`,
    messages: [{ role: "user", content }],
    jsonMode: true,
    temperature: 0.2,
  });

  try {
    return JSON.parse(response.content);
  } catch {
    return { theories: [], contexts: [], methods: [], gaps: [] };
  }
}

// Steps 2-5: Generate, deduplicate, rank ideas
async function generateAndRankIdeas(
  dimensions: ResearchDimensions,
  papers: UnifiedPaper[],
  provider: AIProvider
): Promise<ResearchIdea[]> {
  const response = await callAI({
    provider,
    system: `你是管理学研究创新专家。基于提供的理论×情境×方法维度和研究空白，生成 5-8 个创新研究想法。

每个想法必须是理论、情境、方法的新颖组合，优先填补已识别的研究空白。

输出 JSON：
{
  "ideas": [
    {
      "id": "idea-1",
      "title": "研究标题（中英文）",
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

评分标准（1-10）：
- novelty: 现有文献中是否存在类似研究？越少越高分
- feasibility: 数据可得性、方法可行性
- impact: 对管理理论和实践的潜在贡献
- overall: 加权平均（novelty×0.4 + feasibility×0.3 + impact×0.3）

按 overall 分数从高到低排序。`,
    messages: [
      {
        role: "user",
        content: `维度提取结果：\n${JSON.stringify(dimensions, null, 2)}\n\n参考文献数量：${papers.length} 篇\n顶级期刊（UTD24/FT50）：${papers.filter((p) => p.journalRanking?.utd24 || p.journalRanking?.ft50).length} 篇`,
      },
    ],
    jsonMode: true,
    temperature: 0.7,
    maxTokens: 4096,
  });

  try {
    const parsed = JSON.parse(response.content);
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
  const response = await callAI({
    provider,
    system: `你是一位顶级管理学期刊（如 AMJ, ASQ, SMJ）的匿名审稿人。
对以下研究提案进行严格的同行评审。

输出 JSON：
{
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1", "不足2"],
  "questions": ["需要作者回答的问题1", "问题2"],
  "verdict": "strong_accept/accept/revise/reject"
}

评审标准：理论贡献、方法严谨性、创新性、实践意义。`,
    messages: [
      {
        role: "user",
        content: `标题: ${idea.title}\n理论: ${idea.theory}\n情境: ${idea.context}\n方法: ${idea.method}\n假设: ${idea.hypothesis}\n贡献: ${idea.contribution}`,
      },
    ],
    jsonMode: true,
    temperature: 0.3,
  });

  try {
    return JSON.parse(response.content);
  } catch {
    return undefined;
  }
}

// Full pipeline
export async function runIdeaPipeline(
  papers: UnifiedPaper[],
  provider: AIProvider = "gemini",
  withPeerReview: boolean = true
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
