/**
 * STORM-style multi-perspective literature review.
 *
 * Phase 1 (Pre-write): Perspective discovery → multi-round dialogue → outline
 * Phase 2 (Write): Generate full review with citations from outline
 *
 * Adapted from Stanford STORM: perspective-guided question asking + citation tracking
 */
import { callAI, streamAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";

export interface ReviewOutline {
  title: string;
  perspectives: string[];
  sections: {
    heading: string;
    perspective: string;
    keyFindings: string[];
    paperRefs: number[]; // indices into papers array
  }[];
  gaps: string[];
  futureDirections: string[];
}

// Phase 1: Generate structured outline from multiple perspectives
export async function generateOutline(
  topic: string,
  papers: UnifiedPaper[],
  perspectives: string[],
  provider: AIProvider = "gemini"
): Promise<ReviewOutline> {
  const paperSummaries = papers
    .slice(0, 30)
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title} (${p.year ?? "N/A"}) — ${p.venue ?? "Unknown"}${p.journalRanking?.badges?.length ? ` [${p.journalRanking.badges.join("/")}]` : ""}\n摘要: ${p.abstract?.slice(0, 200) ?? "N/A"}`
    )
    .join("\n\n");

  const response = await callAI({
    provider,
    system: `你是管理学文献综述专家。你需要从多个研究视角分析文献，生成结构化综述大纲。

研究视角包括：${perspectives.join("、")}

请严格按 JSON 格式输出：
{
  "title": "综述标题",
  "perspectives": ["视角1", "视角2", ...],
  "sections": [
    {
      "heading": "章节标题",
      "perspective": "对应视角",
      "keyFindings": ["发现1", "发现2"],
      "paperRefs": [1, 3, 5]
    }
  ],
  "gaps": ["研究空白1", "研究空白2"],
  "futureDirections": ["方向1", "方向2"]
}

paperRefs 中的数字对应文献编号 [1], [2] 等。确保每个发现都有文献支撑。`,
    messages: [
      {
        role: "user",
        content: `研究主题: ${topic}\n\n文献列表:\n${paperSummaries}`,
      },
    ],
    jsonMode: true,
    temperature: 0.3,
  });

  try {
    return JSON.parse(response.content) as ReviewOutline;
  } catch {
    return {
      title: topic,
      perspectives,
      sections: [],
      gaps: [],
      futureDirections: [],
    };
  }
}

// Phase 2: Generate full review text with citations (streaming)
export async function* generateReviewStream(
  outline: ReviewOutline,
  papers: UnifiedPaper[],
  provider: AIProvider = "gemini"
): AsyncGenerator<string> {
  const paperList = papers
    .slice(0, 30)
    .map(
      (p, i) =>
        `[${i + 1}] ${p.authors?.[0]?.name ?? "Unknown"} et al. (${p.year ?? "N/A"}). ${p.title}. ${p.venue ?? ""}${p.journalRanking?.badges?.length ? ` [${p.journalRanking.badges.join("/")}]` : ""}\n摘要: ${p.abstract?.slice(0, 300) ?? "N/A"}`
    )
    .join("\n\n");

  const outlineText = outline.sections
    .map(
      (s) =>
        `## ${s.heading}（${s.perspective}视角）\n核心发现：${s.keyFindings.join("；")}\n引用文献：${s.paperRefs.map((r) => `[${r}]`).join(", ")}`
    )
    .join("\n\n");

  const gapsText = outline.gaps.join("\n- ");
  const futureText = outline.futureDirections.join("\n- ");

  const stream = streamAI({
    provider,
    system: `你是管理学文献综述撰写专家。根据提供的大纲和文献信息，撰写一篇完整的结构化文献综述。

写作要求：
1. 每个论点必须标注引文编号，如"...研究发现X (Author et al., 2023) [1]"
2. 注意区分各研究视角的分析角度
3. 标注期刊等级（UTD24/FT50/ABS4*）以体现文献权威性
4. 在研究Gap部分明确指出现有文献的不足
5. 用学术中文写作，段落清晰
6. 综述末尾附上参考文献列表`,
    messages: [
      {
        role: "user",
        content: `# 综述大纲\n\n标题: ${outline.title}\n\n${outlineText}\n\n研究空白:\n- ${gapsText}\n\n未来方向:\n- ${futureText}\n\n# 参考文献\n\n${paperList}`,
      },
    ],
    temperature: 0.4,
    maxTokens: 8192,
  });

  let result = await stream.next();
  while (!result.done) {
    yield result.value;
    result = await stream.next();
  }
}
