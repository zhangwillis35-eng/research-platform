/**
 * Academic paper English → Chinese translation pipeline.
 *
 * Design principles (inspired by PDFMathTranslate + academic translation best practices):
 * - Section-by-section translation for quality + streaming UX
 * - Placeholder preservation: citations [1], formulas, Figure/Table refs
 * - Term extraction with self-verification round
 * - Temperature 0.1 for consistency across sections
 */
import { callAI, streamAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";

export interface AcademicTerm {
  en: string;
  zh: string;
  isAccurate: boolean;
  correction?: string;
  category: "theory" | "method" | "concept" | "other";
}

export interface PaperAnalysis {
  summary: string;
  methods: string;
  contributions: string;
  innovations: string;
}

export type TranslateStreamEvent =
  | { phase: "section-start"; heading: string; index: number; total: number }
  | { phase: "chunk"; text: string }
  | { phase: "section-done"; index: number }
  | { phase: "terms"; terms: AcademicTerm[] }
  | { phase: "analysis"; analysis: PaperAnalysis }
  | { phase: "done" }
  | { phase: "error"; error: string };

// ─── Section splitter ──────────────────────────────────────

const HEADING_PATTERN =
  /^(?:\d{1,2}\.?\s{0,3}(?=[A-Z])|\*{1,3}[A-Z]|(?:ABSTRACT|INTRODUCTION|BACKGROUND|LITERATURE|THEORY|HYPOTHES|METHOD|DATA|MEASURE|RESULT|FINDING|ANALYSIS|DISCUSSION|CONCLUSION|REFERENCE|APPENDIX|ACKNOWLEDG|LIMITATION))/i;

function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 120) return false;
  return HEADING_PATTERN.test(trimmed);
}

function splitIntoSections(
  text: string
): { heading: string; content: string }[] {
  const lines = text.split(/\r?\n/);
  const sections: { heading: string; content: string }[] = [];
  let heading = "";
  let buffer: string[] = [];

  for (const line of lines) {
    if (isHeading(line)) {
      if (buffer.join("").trim().length > 80) {
        sections.push({ heading, content: buffer.join("\n").trim() });
      }
      heading = line.trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  if (buffer.join("").trim().length > 80) {
    sections.push({ heading, content: buffer.join("\n").trim() });
  }

  // If splitting yielded nothing useful, return as single block
  if (sections.length === 0) {
    return [{ heading: "", content: text.trim() }];
  }
  return sections;
}

// ─── Translation prompt ────────────────────────────────────

const TRANSLATE_SYSTEM = `You are a professional academic translator specializing in management, organizational behavior, and social sciences.

Rules (MUST follow strictly):
1. Translate English → Chinese (简体中文) using formal academic writing style.
2. Preserve ALL citation markers exactly: [1], [1,2,3], (Author, Year), (Author et al., Year).
3. Preserve figure/table references with standard Chinese: "Figure 1" → "图1", "Table 2" → "表2".
4. Keep formulas, equations, and statistical notations UNCHANGED (e.g., β = .23, p < .001, R² = .45).
5. Keep variable names and scale names UNCHANGED on first mention, add Chinese in parentheses.
6. Standard term translations: hypothesis→假设, mediat*→中介, moderat*→调节, construct→构念, sample→样本, survey→问卷调查, regression→回归, correlation→相关, variance→方差, reliability→信度, validity→效度.
7. Output ONLY the translated text. No explanations, no original text.`;

// ─── Term extraction prompt ────────────────────────────────

const TERMS_SYSTEM = `You are an academic translation verification expert in management research.

Extract 15-25 key academic terms from the paper. Self-verify each translation against standard Chinese management/social science literature.

Output JSON (ALL content in Chinese for zh fields):
{
  "terms": [
    {
      "en": "English term",
      "zh": "标准中文翻译",
      "isAccurate": true,
      "correction": "更准确的翻译（仅在isAccurate=false时提供）",
      "category": "theory|method|concept|other"
    }
  ]
}

Categories: theory=理论术语, method=研究方法, concept=核心概念, other=其他术语`;

// ─── Analysis prompt ───────────────────────────────────────

const ANALYSIS_SYSTEM = `You are a research analysis expert. Analyze the academic paper and provide structured Chinese insights.

Output JSON (ALL values in Chinese 中文):
{
  "summary": "研究概要：研究问题、研究对象/样本、主要发现（2-3段）",
  "methods": "研究方法：数据来源、分析方法、样本规模与特征、关键测量工具",
  "contributions": "学术贡献：对领域理论、实践或方法论的贡献（3-5点）",
  "innovations": "创新点：与现有文献的主要区别，填补了哪些研究空白（3-5点）"
}`;

// ─── Public API ────────────────────────────────────────────

export async function* translatePaperStream(
  fullText: string,
  title: string,
  provider: AIProvider
): AsyncGenerator<TranslateStreamEvent> {
  // Trim text to reasonable size (DeepSeek can handle ~32k tokens)
  const text = fullText.slice(0, 60000);
  const sections = splitIntoSections(text);
  const total = sections.length;

  for (let i = 0; i < sections.length; i++) {
    const { heading, content } = sections[i];

    // Skip references section (just preserve as-is)
    if (/^references?$/i.test(heading.trim())) {
      yield { phase: "section-start", heading: "参考文献", index: i, total };
      yield { phase: "chunk", text: "\n[参考文献列表保留英文原文，如需翻译请单独处理]\n" };
      yield { phase: "section-done", index: i };
      continue;
    }

    // Translate section heading
    const translatedHeading = heading
      ? heading
          .replace(/^(\d+\.?\s*)/, "$1")
          .replace(
            /\b(ABSTRACT|Abstract)\b/i,
            "摘要"
          )
          .replace(/\b(INTRODUCTION|Introduction)\b/i, "引言")
          .replace(/\b(CONCLUSION|Conclusion)S?\b/i, "结论")
          .replace(/\b(DISCUSSION|Discussion)\b/i, "讨论")
          .replace(/\b(METHOD|Method)S?\b/i, "方法")
          .replace(/\b(RESULT|Result)S?\b/i, "结果")
          .replace(/\b(LITERATURE|Literature)\b/i, "文献综述")
          .replace(/\b(THEOR\w+|Theor\w+)\b/i, "理论背景")
          .replace(/\b(HYPOTHES\w+|Hypothes\w+)\b/i, "假设推导")
          .replace(/\b(DATA|Data)\b/i, "数据")
          .replace(/\b(MEASURE\w+|Measure\w+)\b/i, "测量")
          .replace(/\b(ANALYS\w+|Analys\w+)\b/i, "分析")
          .replace(/\b(FINDING\w+|Finding\w+)\b/i, "研究发现")
          .replace(/\b(LIMITATION\w+|Limitation\w+)\b/i, "研究局限")
          .replace(/\b(ACKNOWLEDGE\w+|Acknowledge\w+)\b/i, "致谢")
          .replace(/\b(APPEND\w+|Append\w+)\b/i, "附录")
      : "";

    yield { phase: "section-start", heading: translatedHeading || heading, index: i, total };

    try {
      const chunkSize = 6000; // chars per chunk if section is large
      const chunks =
        content.length > chunkSize
          ? splitByParagraphs(content, chunkSize)
          : [content];

      for (const chunk of chunks) {
        const userMsg =
          title && i === 0
            ? `Paper title: "${title}"\n\n${chunk}`
            : chunk;

        for await (const token of streamAI({
          provider,
          system: TRANSLATE_SYSTEM,
          messages: [{ role: "user", content: userMsg }],
          temperature: 0.1,
          maxTokens: 8000,
        })) {
          yield { phase: "chunk", text: token };
        }
      }
    } catch (err) {
      yield {
        phase: "error",
        error: `翻译第${i + 1}节时出错: ${String(err)}`,
      };
      return;
    }

    yield { phase: "section-done", index: i };
  }

  yield { phase: "done" };
}

function splitByParagraphs(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

export async function extractAndVerifyTerms(
  fullText: string,
  title: string,
  provider: AIProvider
): Promise<AcademicTerm[]> {
  const text = fullText.slice(0, 15000);
  try {
    const response = await callAI({
      provider,
      system: TERMS_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Paper: "${title}"\n\n${text}`,
        },
      ],
      jsonMode: true,
      noThinking: true,
      temperature: 0.1,
      maxTokens: 3000,
    });
    const jsonStr = response.content
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(jsonStr);
    return parsed.terms ?? [];
  } catch {
    return [];
  }
}

export async function analyzePaper(
  fullText: string,
  title: string,
  provider: AIProvider
): Promise<PaperAnalysis | null> {
  const text = fullText.slice(0, 20000);
  try {
    const response = await callAI({
      provider,
      system: ANALYSIS_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Paper: "${title}"\n\n${text}`,
        },
      ],
      jsonMode: true,
      noThinking: true,
      temperature: 0.2,
      maxTokens: 3000,
    });
    const jsonStr = response.content
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}
