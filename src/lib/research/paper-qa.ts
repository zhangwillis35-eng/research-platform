/**
 * Paper Q&A pipeline — PaperQA2-inspired retrieval + LLM reranking.
 *
 * Architecture:
 *   1. Full-text search (PostgreSQL tsvector) → top 30 candidates
 *   2. LLM reranking (DeepSeek) → top 8 most relevant chunks
 *   3. Source-grounded answer generation with inline citations
 */

import { callAI, streamAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { prisma } from "@/lib/db";

interface RetrievedChunk {
  id: string;
  content: string;
  section: string | null;
  paperId: string;
  paperTitle: string;
  authors: string;
  year: number | null;
  venue: string | null;
  score: number;
}

interface RankedChunk extends RetrievedChunk {
  relevance: number;
  summary: string;
}

// ─── Stage 1: Hybrid Retrieval ──────────────────────

async function retrieveChunks(
  projectId: string,
  query: string,
  topK: number = 30,
): Promise<RetrievedChunk[]> {
  // Split query into individual search terms for ILIKE fallback
  const terms = query.split(/\s+/).filter((t) => t.length >= 2).slice(0, 8);

  // Strategy 1: PostgreSQL full-text search (English)
  const ftsResults: RetrievedChunk[] = [];
  try {
    const rows = await prisma.$queryRawUnsafe<
      { id: string; content: string; section: string | null; paperId: string; title: string; authors: unknown; year: number | null; venue: string | null; rank: number }[]
    >(
      `SELECT pc.id, pc.content, pc.section, pc."paperId",
              p.title, p.authors, p.year, p.venue,
              ts_rank_cd(to_tsvector('english', pc.content), plainto_tsquery('english', $2)) AS rank
       FROM "PaperChunk" pc
       JOIN "Paper" p ON pc."paperId" = p.id
       WHERE pc."projectId" = $1
         AND to_tsvector('english', pc.content) @@ plainto_tsquery('english', $2)
       ORDER BY rank DESC
       LIMIT $3`,
      projectId,
      query,
      topK,
    );
    for (const r of rows) {
      ftsResults.push({
        id: r.id, content: r.content, section: r.section, paperId: r.paperId,
        paperTitle: r.title, authors: formatAuthors(r.authors), year: r.year, venue: r.venue,
        score: Number(r.rank),
      });
    }
  } catch { /* FTS may fail on empty query or CJK text */ }

  // Strategy 2: ILIKE fallback for terms FTS missed (especially CJK)
  if (ftsResults.length < topK && terms.length > 0) {
    const seenIds = new Set(ftsResults.map((r) => r.id));
    const likeCondition = terms.map((_, i) => `pc.content ILIKE $${i + 3}`).join(" OR ");
    const likeParams = terms.map((t) => `%${t}%`);

    try {
      const rows = await prisma.$queryRawUnsafe<
        { id: string; content: string; section: string | null; paperId: string; title: string; authors: unknown; year: number | null; venue: string | null }[]
      >(
        `SELECT pc.id, pc.content, pc.section, pc."paperId",
                p.title, p.authors, p.year, p.venue
         FROM "PaperChunk" pc
         JOIN "Paper" p ON pc."paperId" = p.id
         WHERE pc."projectId" = $1
           AND (${likeCondition})
         LIMIT $2`,
        projectId,
        topK - ftsResults.length,
        ...likeParams,
      );
      for (const r of rows) {
        if (!seenIds.has(r.id)) {
          ftsResults.push({
            id: r.id, content: r.content, section: r.section, paperId: r.paperId,
            paperTitle: r.title, authors: formatAuthors(r.authors), year: r.year, venue: r.venue,
            score: 0.5,
          });
        }
      }
    } catch { /* ILIKE fallback failure is non-critical */ }
  }

  return ftsResults;
}

function formatAuthors(authors: unknown): string {
  if (!authors) return "Unknown";
  if (typeof authors === "string") return authors;
  if (Array.isArray(authors)) {
    const names = authors.map((a: { name?: string }) => a.name ?? "Unknown");
    if (names.length <= 2) return names.join(" & ");
    return `${names[0]} et al.`;
  }
  return "Unknown";
}

// ─── Stage 2: LLM Reranking (PaperQA2 pattern) ─────

async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  provider: AIProvider = "deepseek-fast",
  topK: number = 8,
): Promise<RankedChunk[]> {
  if (chunks.length === 0) return [];

  // If few chunks, skip reranking
  if (chunks.length <= topK) {
    return chunks.map((c) => ({ ...c, relevance: c.score, summary: "" }));
  }

  // Batch chunks for reranking (max 20 per call to stay within context)
  const batchSize = 20;
  const allRanked: RankedChunk[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const passageList = batch
      .map(
        (c, j) =>
          `[${j}] From "${c.paperTitle}" (${c.year ?? "N/A"}), section: ${c.section ?? "unknown"}\n${c.content.slice(0, 1500)}`,
      )
      .join("\n\n---\n\n");

    try {
      const response = await callAI({
        provider,
        system: `You are an academic research assistant evaluating passage relevance.
For each passage, score its relevance to the question from 0-10 and write a 1-sentence summary of how it relates.

Output strict JSON array:
[{"idx": 0, "score": 8, "summary": "This passage discusses..."}]

Scoring: 9-10 = directly answers the question, 7-8 = highly relevant evidence, 5-6 = somewhat related, 0-4 = not relevant.`,
        messages: [
          {
            role: "user",
            content: `Question: ${query}\n\nPassages:\n${passageList}`,
          },
        ],
        jsonMode: true,
        noThinking: true,
        temperature: 0.1,
        maxTokens: 2048,
      });

      const scores: { idx: number; score: number; summary: string }[] =
        JSON.parse(response.content);

      for (const s of scores) {
        if (s.idx >= 0 && s.idx < batch.length) {
          allRanked.push({
            ...batch[s.idx],
            relevance: s.score,
            summary: s.summary ?? "",
          });
        }
      }
    } catch {
      // Fallback: keep original scores
      for (const c of batch) {
        allRanked.push({ ...c, relevance: c.score * 10, summary: "" });
      }
    }
  }

  // Sort by relevance and return top K
  allRanked.sort((a, b) => b.relevance - a.relevance);
  return allRanked.slice(0, topK);
}

// ─── Stage 3: Source-Grounded Answer Generation ─────

const QA_SYSTEM = `你是一位学术研究分析助手。你的任务是基于提供的文献原文段落，回答用户的研究问题。

严格规则：
1. **仅使用提供的文献内容**回答。如果文献中没有相关信息，明确告知用户。
2. 每个论点都必须标注行内引用，格式为 [作者, 年份]，如 [Smith et al., 2024]。
3. 综合多篇文献时，注明各文献的一致性或分歧。
4. 如果涉及具体数据（效应量、样本量等），准确引用原文数据。
5. 回答需要系统、全面、准确，覆盖所有相关文献的观点。
6. 用中文回答，关键学术术语保留英文。
7. 在回答末尾附上「引用来源」列表，列出所有引用的论文及其对应段落所属章节。`;

export async function* answerQuestion(
  projectId: string,
  question: string,
  provider: AIProvider = "deepseek-fast",
  chatHistory: { role: string; content: string }[] = [],
): AsyncGenerator<string, void> {
  // Stage 0: Translate question to English for FTS (papers are mostly English)
  let searchQuery = question;
  const hasChinese = /[\u4e00-\u9fff]/.test(question);
  if (hasChinese) {
    try {
      const trans = await callAI({
        provider: "deepseek-fast",
        system: "Translate the user's academic research question to English keywords for full-text search. Output ONLY the English keywords, no explanation.",
        messages: [{ role: "user", content: question }],
        noThinking: true,
        temperature: 0.1,
        maxTokens: 200,
      });
      searchQuery = trans.content.trim();
    } catch { /* use original */ }
  }

  // Stage 1: Retrieve
  const candidates = await retrieveChunks(projectId, searchQuery, 30);

  if (candidates.length === 0) {
    yield "未找到相关文献段落。请确保已上传 PDF 并完成文献索引。";
    return;
  }

  // Stage 2: Rerank
  const topChunks = await rerankChunks(question, candidates, "deepseek-fast", 8);

  // Filter out low-relevance chunks
  const relevant = topChunks.filter((c) => c.relevance >= 5);
  if (relevant.length === 0) {
    yield "文献库中未找到与该问题高度相关的内容。请尝试换个角度提问，或确认已上传相关领域的 PDF。";
    return;
  }

  // Stage 3: Generate answer
  const sourcesContext = relevant
    .map(
      (c, i) =>
        `[来源 ${i + 1}] ${c.paperTitle} (${c.authors}, ${c.year ?? "N/A"}) — ${c.section ?? "正文"}\n${c.content}`,
    )
    .join("\n\n" + "─".repeat(40) + "\n\n");

  // Include recent chat history for multi-turn context
  const historyMessages = chatHistory.slice(-4).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const stream = streamAI({
    provider,
    system: QA_SYSTEM,
    messages: [
      ...historyMessages,
      {
        role: "user",
        content: `## 文献来源（${relevant.length} 个相关段落）\n\n${sourcesContext}\n\n## 用户问题\n\n${question}`,
      },
    ],
    temperature: 0.3,
    maxTokens: 4096,
  });

  for await (const chunk of stream) {
    yield chunk;
  }
}

// ─── Index Paper Chunks ─────────────────────────────

import { chunkPaper } from "./paper-chunker";

export async function indexPaperChunks(paperId: string): Promise<number> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: { id: true, projectId: true, fullText: true },
  });

  if (!paper?.fullText) return 0;

  // Delete existing chunks for this paper
  await prisma.paperChunk.deleteMany({ where: { paperId } });

  // Chunk the paper
  const chunks = chunkPaper(paper.fullText);

  if (chunks.length === 0) return 0;

  // Batch insert in groups of 100 to avoid parameter limits
  const data = chunks.map((c) => ({
    paperId: paper.id,
    projectId: paper.projectId,
    section: c.section,
    content: c.content,
    chunkIdx: c.chunkIdx,
  }));
  for (let i = 0; i < data.length; i += 100) {
    await prisma.paperChunk.createMany({ data: data.slice(i, i + 100) });
  }

  return chunks.length;
}

export async function indexProjectPapers(
  projectId: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<{ indexed: number; totalChunks: number }> {
  const papers = await prisma.paper.findMany({
    where: { projectId, fullText: { not: null } },
    select: { id: true },
  });

  let totalChunks = 0;
  for (let i = 0; i < papers.length; i++) {
    const count = await indexPaperChunks(papers[i].id);
    totalChunks += count;
    onProgress?.(i + 1, papers.length);
  }

  return { indexed: papers.length, totalChunks };
}
