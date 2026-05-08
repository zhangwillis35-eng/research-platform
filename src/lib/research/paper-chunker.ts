/**
 * Section-aware paper chunker for RAG Q&A.
 *
 * Splits academic paper full text into ~800-token chunks,
 * preserving section boundaries and adding metadata.
 */

const SECTION_PATTERNS: [RegExp, string][] = [
  [/^(?:abstract|摘\s*要)\b/im, "abstract"],
  [/^(?:\d+\.?\s*)?(?:introduction|引言|绪论)\b/im, "introduction"],
  [/^(?:\d+\.?\s*)?(?:literature\s+review|related\s+work|theoretical\s+(?:background|framework)|文献\s*综述|理论\s*(?:背景|框架))\b/im, "literature_review"],
  [/^(?:\d+\.?\s*)?(?:hypothes[ie]s?\s+development|研究\s*假设)\b/im, "hypotheses"],
  [/^(?:\d+\.?\s*)?(?:method(?:ology)?|research\s+(?:design|method)|研究\s*(?:方法|设计))\b/im, "methodology"],
  [/^(?:\d+\.?\s*)?(?:results?|findings?|data\s+analysis|研究\s*结果|数据\s*分析)\b/im, "results"],
  [/^(?:\d+\.?\s*)?(?:discussion|讨论)\b/im, "discussion"],
  [/^(?:\d+\.?\s*)?(?:conclusion|implications?|结论|启示)\b/im, "conclusion"],
  [/^(?:\d+\.?\s*)?(?:references?|bibliography|参考\s*文献)\b/im, "references"],
  [/^(?:\d+\.?\s*)?(?:appendix|附录)\b/im, "appendix"],
];

export interface TextChunk {
  content: string;
  section: string;
  chunkIdx: number;
}

/**
 * Split full text into named sections using common academic headings.
 */
function splitIntoSections(fullText: string): { name: string; text: string }[] {
  const lines = fullText.split("\n");
  const sections: { name: string; startLine: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 120) continue; // headings are short

    for (const [pattern, name] of SECTION_PATTERNS) {
      if (pattern.test(line)) {
        sections.push({ name, startLine: i });
        break;
      }
    }
  }

  if (sections.length === 0) {
    return [{ name: "body", text: fullText }];
  }

  const result: { name: string; text: string }[] = [];

  // Text before first detected section
  if (sections[0].startLine > 0) {
    const preText = lines.slice(0, sections[0].startLine).join("\n").trim();
    if (preText.length > 100) {
      result.push({ name: "header", text: preText });
    }
  }

  for (let i = 0; i < sections.length; i++) {
    const start = sections[i].startLine;
    const end = i + 1 < sections.length ? sections[i + 1].startLine : lines.length;
    const text = lines.slice(start, end).join("\n").trim();
    if (text.length > 50) {
      result.push({ name: sections[i].name, text });
    }
  }

  return result;
}

/**
 * Chunk a text block into ~800 token (~3200 char) pieces with overlap.
 */
function chunkText(
  text: string,
  maxChars: number = 3200,
  overlapChars: number = 800,
): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    // Try to break at paragraph or sentence boundary
    if (end < text.length) {
      const paraBreak = text.lastIndexOf("\n\n", end);
      if (paraBreak > start + maxChars * 0.3) {
        end = paraBreak;
      } else {
        const sentBreak = text.lastIndexOf(". ", end);
        if (sentBreak > start + maxChars * 0.3) {
          end = sentBreak + 1;
        }
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    // Advance start — ensure it always moves forward
    const nextStart = end - overlapChars;
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

/**
 * Main entry: chunk a paper's full text into indexed chunks.
 * Skips references and appendix sections.
 */
export function chunkPaper(fullText: string): TextChunk[] {
  const sections = splitIntoSections(fullText);
  const chunks: TextChunk[] = [];
  let idx = 0;

  for (const section of sections) {
    // Skip references and appendix — they add noise to retrieval
    if (section.name === "references" || section.name === "appendix") continue;

    const textChunks = chunkText(section.text);
    for (const content of textChunks) {
      chunks.push({ content, section: section.name, chunkIdx: idx++ });
    }
  }

  return chunks;
}
