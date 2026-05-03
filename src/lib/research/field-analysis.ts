/**
 * Field-level analysis: takeaways & assumptions extraction.
 *
 * Supports triple-engine dispatch:
 * - "builtin": Direct LLM calls via ScholarFlow's AI providers
 * - "storm": STORM Python bridge with field-summary/assumptions modes
 * - "notebooklm": Auto-import to NotebookLM + grounded Q&A
 */

import { streamAI } from "@/lib/ai";
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

const FIELD_TAKEAWAYS_PROMPT = `You are a senior academic researcher synthesizing the key takeaways from a collection of papers within a specific research field.

Generate a comprehensive field-level synthesis covering:

1. **核心发现与共识** — Most important findings, where papers converge. Cite by [number].
2. **主流方法论趋势** — Dominant research designs, data sources, emerging methodological innovations.
3. **主要争论与张力** — Where papers disagree, unresolved debates, conflicting evidence.
4. **新兴趋势** — New directions gaining traction, cross-disciplinary influences.
5. **研究空白** — Important unanswered questions, understudied contexts/variables. Ground each gap in the reviewed literature.

Requirements:
- Respond in Chinese (学术写作风格)
- Cite papers using [number] format matching the input order
- Be synthetic — identify field-level patterns, not individual paper summaries
- Minimum 2500 Chinese characters`;

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
    temperature: 0.7,
    maxTokens: 8000,
  });

  for await (const chunk of stream) {
    yield chunk;
  }
}

// ────────────────────────────────────────────
// Assumptions Analysis
// ────────────────────────────────────────────

const ASSUMPTIONS_PROMPT = `You are an expert at identifying and comparing research assumptions across academic papers.

## Part 1: Per-Paper Assumption Extraction
For EACH paper, identify:
1. **理论假设** — Theoretical frameworks taken as given, assumed causal mechanisms
2. **方法论假设** — Measurement validity, data distribution, statistical assumptions
3. **边界条件** — Contexts where findings are assumed to hold, scope limitations
4. **隐含假设** — What is taken for granted but not explicitly stated

## Part 2: Cross-Paper Comparison
1. **共享假设** — Assumptions held across most/all papers, whether well-grounded or conventional
2. **冲突假设** — Contradictory assumptions, implications, which is better supported
3. **独特假设** — Assumptions unique to specific papers, innovation vs. limitation

Requirements:
- Respond in Chinese (学术写作风格)
- Cite papers using [number] format
- Be analytical — compare and evaluate, don't just list
- Highlight the most consequential assumption differences
- Minimum 2000 Chinese characters`;

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
    temperature: 0.7,
    maxTokens: 8000,
  });

  for await (const chunk of stream) {
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
