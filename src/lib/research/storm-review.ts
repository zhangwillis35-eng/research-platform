/**
 * STORM-style multi-perspective literature review.
 *
 * Phase 1 (Pre-write): Perspective discovery → outline
 * Phase 2 (Write): Parallel section generation → merge → coherence pass
 */
import { callAI, streamAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";
import { concurrentPool } from "@/lib/concurrent-pool";
import { batchStream } from "@/lib/batch-stream";

export interface ReviewOutline {
  title: string;
  perspectives: string[];
  sections: {
    heading: string;
    perspective: string;
    keyFindings: string[];
    paperRefs: number[];
  }[];
  gaps: string[];
  futureDirections: string[];
}

export interface ReviewOptions {
  topic: string;
  papers: UnifiedPaper[];
  perspectives?: string[];
  provider?: AIProvider;
  wordCount?: { min: number; max: number };
}

// Phase 1: Generate structured outline
export async function generateOutline(
  options: ReviewOptions
): Promise<ReviewOutline> {
  const {
    topic,
    papers,
    perspectives = ["理论视角", "实证方法视角", "应用情境视角", "批评与争议视角"],
    provider = "deepseek-fast",
  } = options;

  const paperSummaries = papers
    .slice(0, 30)
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title} (${p.year ?? "N/A"}) — ${p.venue ?? "Unknown"}${p.journalRanking?.badges?.length ? ` [${p.journalRanking.badges.join("/")}]` : ""}\n摘要: ${p.abstract ?? "N/A"}`
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
    noThinking: true,
    temperature: 0.3,
  });

  try {
    return JSON.parse(response.content) as ReviewOutline;
  } catch {
    return { title: topic, perspectives, sections: [], gaps: [], futureDirections: [] };
  }
}

// ─── Phase 2: Parallel section generation ────────

const SECTION_SYSTEM = `你是管理学文献综述撰写专家。你负责撰写综述中的一个章节。

写作要求：
1. 每个论点必须标注引文编号，如"...研究发现X (Author et al., 2023) [1]"
2. 注意本章节的研究视角
3. 标注期刊等级（UTD24/FT50/ABS4*）以体现文献权威性
4. 用学术中文写作，段落清晰，逻辑连贯
5. 不要输出章节标题（系统会自动添加）
6. 直接输出正文内容`;

const COHERENCE_SYSTEM = `你是管理学文献综述编辑专家。给你一篇由多个章节拼接而成的文献综述，请进行最终润色：
1. 确保章节间逻辑过渡自然
2. 添加引言段（综述目的、范围、结构说明）
3. 添加总结段（研究空白汇总、未来方向）
4. 保留所有引文标注 [编号]
5. 在末尾附上完整参考文献列表
6. 用学术中文写作
7. 不要删减任何实质内容`;

async function generateSectionText(
  section: ReviewOutline["sections"][0],
  papers: UnifiedPaper[],
  provider: AIProvider,
  targetWords: number,
): Promise<string> {
  const relevantPapers = section.paperRefs
    .filter((r) => r > 0 && r <= papers.length)
    .map((r) => {
      const p = papers[r - 1];
      const ft = (p as unknown as { fullText?: string }).fullText;
      return `[${r}] ${p.authors?.[0]?.name ?? "Unknown"} et al. (${p.year ?? "N/A"}). ${p.title}. ${p.venue ?? ""}${p.journalRanking?.badges?.length ? ` [${p.journalRanking.badges.join("/")}]` : ""}\n摘要: ${p.abstract ?? "N/A"}${ft ? `\n全文: ${ft}` : ""}`;
    })
    .join("\n\n");

  const response = await callAI({
    provider,
    system: SECTION_SYSTEM,
    messages: [{
      role: "user",
      content: `## 章节: ${section.heading}（${section.perspective}视角）\n\n核心发现：\n${section.keyFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n相关文献:\n${relevantPapers}\n\n请撰写约 ${targetWords} 字的章节正文。`,
    }],
    noThinking: true,
    temperature: 0.4,
    maxTokens: Math.max(2048, Math.ceil(targetWords * 1.5)),
  });

  return response.content;
}

// Phase 2: Generate full review (parallel sections → coherence pass → stream)
export async function* generateReviewStream(
  outline: ReviewOutline,
  papers: UnifiedPaper[],
  provider: AIProvider = "deepseek-fast",
  wordCount?: { min: number; max: number },
  stormContext?: string,
): AsyncGenerator<string> {
  const totalTarget = wordCount ? Math.round((wordCount.min + wordCount.max) / 2) : 6000;
  const sectionCount = outline.sections.length || 1;
  // Reserve ~15% for intro/conclusion/refs, distribute rest evenly
  const bodyTarget = Math.round(totalTarget * 0.85);
  const perSectionTarget = Math.round(bodyTarget / sectionCount);

  // Generate all sections in parallel (up to 4 concurrent)
  yield `正在并行生成 ${sectionCount} 个章节...\n\n`;

  const sectionTexts = new Array<string>(sectionCount).fill("");
  await concurrentPool(
    outline.sections,
    async (section, idx) => {
      const text = await generateSectionText(section, papers, provider, perSectionTarget);
      sectionTexts[idx] = text;
      return text;
    },
    4,
  );

  // Assemble draft
  const assembled = outline.sections.map((s, i) =>
    `## ${s.heading}\n\n${sectionTexts[i]}`
  ).join("\n\n");

  const gapsText = outline.gaps.length > 0 ? `\n\n## 研究空白\n\n${outline.gaps.map(g => `- ${g}`).join("\n")}` : "";
  const futureText = outline.futureDirections.length > 0 ? `\n\n## 未来研究方向\n\n${outline.futureDirections.map(d => `- ${d}`).join("\n")}` : "";

  const paperList = papers
    .slice(0, 30)
    .map(
      (p, i) =>
        `[${i + 1}] ${p.authors?.[0]?.name ?? "Unknown"} et al. (${p.year ?? "N/A"}). ${p.title}. ${p.venue ?? ""}`
    )
    .join("\n");

  const rawDraft = `# ${outline.title}\n\n${assembled}${gapsText}${futureText}\n\n## 参考文献\n\n${paperList}`;

  // Coherence pass — stream the final polished version (no input truncation)

  try {
    const stream = streamAI({
      provider,
      system: COHERENCE_SYSTEM,
      messages: [{
        role: "user",
        content: `以下是由多个章节并行生成后拼接的文献综述草稿。请润色为一篇连贯的完整综述。\n\n目标字数: ${totalTarget} 字（${wordCount ? `${wordCount.min}-${wordCount.max}` : "约6000"}字）\n\n${stormContext ? `[STORM 深度分析参考]\n${stormContext}\n\n` : ""}${rawDraft}`,
      }],
      noThinking: true,

      temperature: 0.3,
      maxTokens: Math.max(8192, Math.ceil(totalTarget * 1.5)),
    });

    for await (const chunk of batchStream(stream, 30)) {
      yield chunk;
    }
  } catch (err) {
    // If coherence pass fails, yield the raw draft instead of nothing
    console.error("[storm-review] Coherence pass failed:", err);
    yield "\n\n[润色步骤失败，以下为原始拼接版本]\n\n";
    yield rawDraft;
  }
}
