/**
 * Field-level analysis: takeaways & assumptions extraction.
 *
 * Supports triple-engine dispatch:
 * - "builtin": Direct LLM calls via ScholarFlow's AI providers
 * - "storm": STORM Python bridge with field-summary/assumptions modes
 * - "notebooklm": Auto-import to NotebookLM + grounded Q&A
 */

import { streamAI } from "@/lib/ai";
import { batchStream } from "@/lib/batch-stream";
import type { AIProvider } from "@/lib/ai";
import { runStormAnalysis } from "@/lib/integrations/storm";
import { askNotebookLM, batchImportToNotebookLM } from "@/lib/integrations/notebooklm";

export interface FieldPaper {
  id: string;
  title: string;
  abstract?: string | null;
  authors: { name: string }[] | string;
  year?: number | null;
  venue?: string | null;
  fullText?: string | null;
  openAccessPdf?: string | null;
  pdfUrl?: string | null;
  doi?: string | null;
}

// ────────────────────────────────────────────
// Field Takeaways
// ────────────────────────────────────────────

const FIELD_TAKEAWAYS_PROMPT = `你是一位资深学术研究者，负责对一组特定研究领域的论文进行领域级别的综合提炼。

请生成全面的领域综合分析，涵盖以下五个方面：

1. **核心发现与共识** — 最重要的研究发现，各文献的共识之处。使用[编号]引用具体文献。
2. **主流方法论趋势** — 主要的研究设计、数据来源、方法论创新。
3. **主要争论与张力** — 文献之间的分歧、未解决的争论、矛盾的证据。
4. **新兴趋势** — 正在兴起的新方向、跨学科影响。
5. **研究空白** — 重要的未解答问题、研究不足的情境和变量。每个空白需有文献依据。

要求：
- 全部使用中文输出，保持学术写作风格
- 使用[编号]格式引用文献，编号与输入顺序一致
- 进行综合性分析，识别领域级别的模式，而非逐篇总结
- 至少2500字`;

export async function* streamFieldTakeaways(
  papers: FieldPaper[],
  engine: "builtin" | "storm" | "notebooklm",
  provider: AIProvider = "deepseek-fast",
  notebookUrl?: string | null,
): AsyncGenerator<string> {
  if (engine === "storm") {
    const { checkStormAvailable } = await import("@/lib/integrations/storm");
    const check = await checkStormAvailable();
    if (!check.available) {
      yield `⚠️ STORM 不可用：${check.error}\n\n服务器 Docker 容器中未安装 Python3 和 knowledge-storm。请使用「Built-in AI」引擎代替。`;
      return;
    }
    const result = await runStormAnalysis(
      "Field synthesis",
      papers.map(formatPaperForStorm),
      { mode: "field-summary" }
    );
    yield result.article;
    return;
  }

  if (engine === "notebooklm") {
    if (!notebookUrl) throw new Error("NotebookLM notebook URL not configured");
    // Auto-import papers
    await autoImportPapers(notebookUrl, papers);
    // Query NotebookLM
    const answer = await askNotebookLM(notebookUrl,
      "Based on all the sources, provide a comprehensive field-level synthesis: " +
      "(1) key findings and consensus, (2) methodological trends, " +
      "(3) major debates and tensions, (4) emerging trends, " +
      "(5) research gaps. Respond in Chinese (学术写作风格). " +
      "Cite specific sources for each point."
    );
    yield answer.answer;
    return;
  }

  // Built-in AI path
  const papersContext = buildPapersContext(papers);
  const stream = streamAI({
    provider,
    messages: [
      { role: "system", content: FIELD_TAKEAWAYS_PROMPT },
      { role: "user", content: `Papers (${papers.length} total):\n\n${papersContext}` },
    ],
    noThinking: true,

    temperature: 0.7,
    maxTokens: 8000,
  });

  for await (const chunk of batchStream(stream, 30)) {
    yield chunk;
  }
}

// ────────────────────────────────────────────
// Assumptions Analysis
// ────────────────────────────────────────────

const ASSUMPTIONS_PROMPT = `你是一位研究假设识别与对比分析专家。

## 第一部分：逐篇假设提取
对每一篇论文，识别以下内容：
1. **理论假设** — 被视为前提的理论框架、假定的因果机制
2. **方法论假设** — 测量效度、数据分布、统计假设
3. **边界条件** — 研究发现被假定成立的情境、适用范围限制
4. **隐含假设** — 未明确陈述但被默认接受的前提

## 第二部分：跨文献假设对比
1. **共享假设** — 大多数或全部文献共同持有的假设，无论是否有充分依据
2. **冲突假设** — 矛盾的假设、其影响、哪个更有证据支持
3. **独特假设** — 某篇论文特有的假设，属于创新还是局限

要求：
- 全部使用中文输出，保持学术写作风格
- 使用[编号]格式引用文献
- 要有分析性——比较和评估，而非简单罗列
- 突出最具影响力的假设差异
- 至少2000字`;

export async function* streamAssumptionsAnalysis(
  papers: FieldPaper[],
  engine: "builtin" | "storm" | "notebooklm",
  provider: AIProvider = "deepseek-fast",
  notebookUrl?: string | null,
): AsyncGenerator<string> {
  if (engine === "storm") {
    const { checkStormAvailable } = await import("@/lib/integrations/storm");
    const check = await checkStormAvailable();
    if (!check.available) {
      yield `⚠️ STORM 不可用：${check.error}\n\n请使用「Built-in AI」引擎代替。`;
      return;
    }
    const result = await runStormAnalysis(
      "Assumptions analysis",
      papers.map(formatPaperForStorm),
      { mode: "assumptions" }
    );
    yield result.article;
    return;
  }

  if (engine === "notebooklm") {
    if (!notebookUrl) throw new Error("NotebookLM notebook URL not configured");
    await autoImportPapers(notebookUrl, papers);

    // Query 1: Extract assumptions
    const q1 = await askNotebookLM(notebookUrl,
      "For each source, extract: (1) theoretical assumptions, (2) methodological assumptions, " +
      "(3) boundary conditions, (4) implicit/unstated assumptions. Respond in Chinese."
    );
    yield q1.answer;
    yield "\n\n---\n\n## 跨文献假设对比\n\n";

    // Query 2: Cross-compare
    const q2 = await askNotebookLM(notebookUrl,
      "Compare the assumptions across all sources: what assumptions are shared, " +
      "what conflicts exist, and what is unique to specific papers? " +
      "Highlight the most consequential differences. Respond in Chinese.",
      q1.sessionId
    );
    yield q2.answer;
    return;
  }

  // Built-in AI path
  const papersContext = buildPapersContext(papers);
  const stream = streamAI({
    provider,
    messages: [
      { role: "system", content: ASSUMPTIONS_PROMPT },
      { role: "user", content: `Papers (${papers.length} total):\n\n${papersContext}` },
    ],
    noThinking: true,

    temperature: 0.7,
    maxTokens: 8000,
  });

  for await (const chunk of batchStream(stream, 30)) {
    yield chunk;
  }
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function buildPapersContext(papers: FieldPaper[]): string {
  return papers.map((p, i) => {
    let text = `[${i + 1}] ${p.title}`;
    if (p.year) text += ` (${p.year})`;
    if (p.venue) text += ` — ${p.venue}`;
    const authors = typeof p.authors === "string"
      ? p.authors
      : (p.authors ?? []).slice(0, 5).map(a => a.name).join(", ");
    if (authors) text += `\nAuthors: ${authors}`;
    if (p.fullText) {
      text += `\n\n${p.fullText.slice(0, 6000)}`;
    } else if (p.abstract) {
      text += `\nAbstract: ${p.abstract}`;
    }
    return text;
  }).join("\n\n" + "=".repeat(40) + "\n\n");
}

function formatPaperForStorm(p: FieldPaper) {
  return {
    title: p.title,
    abstract: p.abstract ?? undefined,
    authors: typeof p.authors === "string" ? p.authors : (p.authors ?? []).map(a => a.name).join(", "),
    year: p.year ?? undefined,
    venue: p.venue ?? undefined,
    fullText: p.fullText?.slice(0, 8000) ?? undefined,
  };
}

async function autoImportPapers(notebookUrl: string, papers: FieldPaper[]) {
  const urls = papers
    .map(p => p.openAccessPdf || p.pdfUrl || (p.doi ? `https://doi.org/${p.doi}` : null))
    .filter((u): u is string => !!u);
  if (urls.length > 0) {
    await batchImportToNotebookLM(notebookUrl, urls);
  }
}
