import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callAI, setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { concurrentPool } from "@/lib/concurrent-pool";
import { batchFetchFullText } from "@/lib/research/fulltext-fetcher";

const MAX_CONCURRENCY = 15;
const FULLTEXT_CONCURRENCY = 20;
const DEFAULT_PROVIDER: AIProvider = "deepseek-fast";

// Abstract-only papers are analyzed in batches — one LLM call per 10 papers
const ABSTRACT_BATCH_SIZE = 10;
const ABSTRACT_BATCH_CONCURRENCY = 5;

// Max full text chars to send to LLM per paper
// deepseek-chat has 64K context; ~8K per paper leaves room for prompt + output
const MAX_FULLTEXT_PER_PAPER = 8000;

const SYSTEM_PROMPT_FULLTEXT =
  `You are a management research methodology expert. You will receive the full text (or abstract) of an academic paper. Perform deep structured analysis based on actual content.

Requirements:
- Extract 3-5 key tags (theory names, method types, research domains)
- Analyze theoretical model, key variables, research methods, and marginal contribution in depth
- All analysis must be strictly based on content you actually read — never fabricate
- If only abstract is available, reduce analysis depth and note accordingly

Respond in Chinese. Return JSON object only, no other text.`;

const SYSTEM_PROMPT_ABSTRACT =
  "You are a management research methodology expert. Extract 3-5 key tags (theory names, method types, research domains) from the paper, and analyze its theoretical model, key variables, research methods, and marginal contribution. Respond in Chinese. Return JSON object only, no other text.";

const SYSTEM_PROMPT_BATCH_ABSTRACT =
  `You are a management research methodology expert. You will receive MULTIPLE papers, each labeled [0], [1], [2]... with title, authors, year, venue, citations, and abstract.

For EACH paper, extract 3-5 key tags (theory names, method types, research domains) and analyze its theoretical model, key variables, research methods, and marginal contribution based strictly on the provided abstract — never fabricate.

ALL text values MUST be written in Chinese (中文). Return a strict JSON object only (no markdown, no other text) in this exact shape:
{"results":[{"index":0,"tags":["标签1","标签2","标签3"],"model":"理论模型分析（1-2句中文）","variables":"关键变量分析：自变量、因变量、中介、调节（中文）","method":"研究方法分析（1-2句中文）","contribution":"边际贡献分析（1-2句中文）","dataSource":"仅摘要"}]}

The "index" field MUST match each paper's [N] label. Include exactly one result object per paper — do not skip any paper.`;

interface PaperRow {
  title: string;
  abstract: string | null;
  authors: unknown;
  year: number | null;
  venue: string | null;
  citationCount: number;
}

function formatAuthors(paper: PaperRow): string {
  return (
    (paper.authors as Array<{ name: string }>)
      ?.slice(0, 3)
      .map((a) => a.name)
      .join(", ") ?? ""
  );
}

/** Batch prompt: multiple abstract-only papers, labeled [0], [1]... for index-keyed results */
function buildBatchAbstractPrompt(papers: PaperRow[]): string {
  return papers
    .map(
      (p, i) => `[${i}] Title: ${p.title}
Authors: ${formatAuthors(p)}
Year: ${p.year ?? "N/A"} | Venue: ${p.venue ?? "N/A"} | Citations: ${p.citationCount}
Abstract: ${(p.abstract ?? "No abstract available").slice(0, 1500)}`
    )
    .join("\n\n---\n\n");
}

function buildPrompt(paper: PaperRow, fullText?: string) {
  const authors = formatAuthors(paper);

  const header = `Title: ${paper.title}
Authors: ${authors}
Year: ${paper.year ?? "N/A"} | Venue: ${paper.venue ?? "N/A"} | Citations: ${paper.citationCount}`;

  if (fullText && fullText.length > 300) {
    return `Perform deep structured analysis based on the following full text.

${header}

=== Full Text ===
${fullText.slice(0, MAX_FULLTEXT_PER_PAPER)}
${fullText.length > MAX_FULLTEXT_PER_PAPER ? "\n...(truncated)" : ""}
=== End ===

Return strict JSON (no markdown), respond in Chinese:
{"tags":["tag1","tag2","tag3"],"model":"theoretical model analysis (2-3 sentences, include specific theory names and logic chain)","variables":"key variable analysis (IV, DV, mediator, moderator, with measurement details)","method":"research method analysis (2-3 sentences, include sample size, data source, analytical method)","contribution":"marginal contribution (2-3 sentences, theoretical and practical innovation)","dataSource":"全文"}`;
  }

  return `Perform structured analysis of the following paper.

${header}
Abstract: ${paper.abstract ?? "No abstract available"}

Return strict JSON (no markdown), respond in Chinese:
{"tags":["tag1","tag2","tag3"],"model":"theoretical model (1-2 sentences)","variables":"key variables (IV, DV, mediator, moderator)","method":"research method (1-2 sentences)","contribution":"marginal contribution (1-2 sentences)","dataSource":"仅摘要"}`;
}

/**
 * POST — analyze papers using concurrent DeepSeek calls (up to 100 threads).
 *
 * Pipeline:
 *   1. Enrich abstracts from OpenAlex (parallel)
 *   2. Fetch full text for all papers (20 concurrent)
 *   3. Send full text + abstract to LLM for deep analysis (100 concurrent)
 *
 * Request body:
 *   { paperIds: string[], provider?: AIProvider, concurrency?: number }
 *
 * Returns SSE stream with per-paper progress events.
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  setAIContext(auth.id, "/api/papers/batch-analyze");

  const body = await request.json();
  const { paperIds, provider, concurrency } = body as {
    paperIds?: string[];
    provider?: AIProvider;
    concurrency?: number;
  };

  if (!paperIds?.length) {
    return new Response(JSON.stringify({ error: "paperIds required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const aiProvider = provider ?? DEFAULT_PROVIDER;
  const poolSize = Math.min(concurrency ?? MAX_CONCURRENCY, MAX_CONCURRENCY);

  const papers = await prisma.paper.findMany({
    where: { id: { in: paperIds }, aiAnalysis: null },
    select: {
      id: true,
      title: true,
      abstract: true,
      authors: true,
      year: true,
      venue: true,
      citationCount: true,
      doi: true,
      openAccessPdf: true,
    },
  });

  if (papers.length === 0) {
    return new Response(
      JSON.stringify({ type: "done", analyzed: 0, failed: 0, total: 0 }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
          const keepalive = setInterval(() => {
            try { controller.enqueue(encoder.encode(`: keepalive

`)); } catch { /* closed */ }
          }, 10000);
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream already closed (client disconnected) */ }
      }

      /** Client disconnected — stop all remaining work and close the stream */
      function abortAndClose(): void {
        console.log("[batch-analyze] client disconnected, aborting");
        clearInterval(keepalive);
        try { controller.close(); } catch { /* already closed */ }
      }

      // Phase 1: Enrich incomplete abstracts from OpenAlex (parallel, fast)
      const needAbstract = papers.filter(
        (p) =>
          !p.abstract ||
          p.abstract.length < 200 ||
          p.abstract.includes("...") ||
          p.abstract.includes("\u2026")
      );

      if (needAbstract.length > 0) {
        send({ type: "status", message: `补全 ${needAbstract.length} 篇摘要中...` });
        await Promise.all(
          needAbstract.map(async (p) => {
            try {
              const url = p.doi
                ? `https://api.openalex.org/works/doi:${p.doi}?select=abstract_inverted_index`
                : `https://api.openalex.org/works?${new URLSearchParams({
                    search: p.title,
                    per_page: "1",
                    select: "abstract_inverted_index,display_name",
                  })}`;
              const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
              if (!res.ok) return;
              const data = await res.json();
              const work = p.doi ? data : data.results?.[0];
              const invIdx = work?.abstract_inverted_index;
              if (!invIdx) return;
              const words: string[] = [];
              for (const [word, positions] of Object.entries(invIdx)) {
                for (const pos of positions as number[]) words[pos] = word;
              }
              const full = words.join(" ").trim();
              if (full.length > 50) {
                p.abstract = full;
                await prisma.paper.update({
                  where: { id: p.id },
                  data: { abstract: full },
                });
              }
            } catch {
              /* skip */
            }
          })
        );
      }

      // Client disconnected during abstract enrichment — stop before full-text fetch
      if (request.signal.aborted) {
        abortAndClose();
        return;
      }

      // Phase 2: Fetch full text for ALL papers (20 concurrent)
      send({
        type: "status",
        message: `获取 ${papers.length} 篇论文全文中 (${FULLTEXT_CONCURRENCY} 并发)...`,
      });

      const fullTextMap = await batchFetchFullText(
        papers.map((p) => ({
          doi: p.doi ?? undefined,
          openAccessPdf: p.openAccessPdf ?? undefined,
          title: p.title,
        })),
        FULLTEXT_CONCURRENCY
      );

      // Client disconnected during full-text fetch — stop before LLM calls
      if (request.signal.aborted) {
        abortAndClose();
        return;
      }

      const withFullText = [...fullTextMap.values()].filter((ft) => ft.text.length > 300).length;
      send({
        type: "status",
        message: `全文获取完成: ${withFullText}/${papers.length} 篇有全文，开始 AI 深度分析 (${poolSize} 并发, ${aiProvider})...`,
      });

      // Phase 3: Concurrent AI analysis.
      // Full-text papers: per-paper calls (8K chars each — can't merge).
      // Abstract-only papers: batched 10-per-call to cut request overhead and cost.
      let analyzed = 0;
      let failed = 0;
      let completed = 0; // shared across both pools
      const total = papers.length;

      const hasFullTextFor = (paper: (typeof papers)[number]): boolean => {
        const ft = fullTextMap.get(paper.doi || paper.title);
        return !!(ft && ft.text.length > 300);
      };
      const fullTextPapers = papers.filter(hasFullTextFor);
      const abstractPapers = papers.filter((p) => !hasFullTextFor(p));

      const sendOk = (paper: (typeof papers)[number], hasFullText: boolean) => {
        analyzed++;
        completed++;
        send({
          type: "progress",
          completed,
          total,
          paperId: paper.id,
          title: paper.title.slice(0, 60),
          status: "ok",
          hasFullText,
        });
      };
      const sendError = (paper: (typeof papers)[number], reason: unknown) => {
        failed++;
        completed++;
        const errMsg =
          reason instanceof Error
            ? reason.message.slice(0, 120)
            : String(reason).slice(0, 120);
        send({
          type: "progress",
          completed,
          total,
          paperId: paper.id,
          title: paper.title.slice(0, 60),
          status: "error",
          error: errMsg,
        });
      };

      // Pool A: full-text papers — one deep-analysis call per paper
      const fullTextPool = concurrentPool(
        fullTextPapers,
        async (paper) => {
          const ft = fullTextMap.get(paper.doi || paper.title);

          const result = await callAI({
            provider: aiProvider,
            messages: [
              {
                role: "user",
                content: buildPrompt(paper, ft?.text),
              },
            ],
            system: SYSTEM_PROMPT_FULLTEXT,
            jsonMode: true,
            noThinking: true,
            temperature: 0.1,
            maxTokens: 1500,
            signal: request.signal,
          });

          const cleaned = result.content
            .replace(/```json\s*/g, "")
            .replace(/```\s*/g, "")
            .trim();
          const analysis = JSON.parse(cleaned);

          await prisma.paper.update({
            where: { id: paper.id },
            data: { aiAnalysis: JSON.stringify(analysis) },
          });

          return analysis;
        },
        poolSize,
        (_completed, _total, result) => {
          const paper = fullTextPapers[result.index];
          if (result.status === "fulfilled") {
            sendOk(paper, true);
          } else {
            sendError(paper, result.reason);
          }
        },
        request.signal
      );

      // Pool B: abstract-only papers — one call per batch of 10
      const abstractBatches: (typeof papers)[] = [];
      for (let i = 0; i < abstractPapers.length; i += ABSTRACT_BATCH_SIZE) {
        abstractBatches.push(abstractPapers.slice(i, i + ABSTRACT_BATCH_SIZE));
      }

      const abstractPool = concurrentPool(
        abstractBatches,
        async (batch) => {
          const result = await callAI({
            provider: aiProvider,
            system: SYSTEM_PROMPT_BATCH_ABSTRACT,
            messages: [{ role: "user", content: buildBatchAbstractPrompt(batch) }],
            jsonMode: true,
            noThinking: true,
            temperature: 0.1,
            maxTokens: Math.max(800, batch.length * 500),
            signal: request.signal,
          });

          const cleaned = result.content
            .replace(/```json\s*/g, "")
            .replace(/```\s*/g, "")
            .trim();
          const parsed = JSON.parse(cleaned);
          // Tolerate both {"results":[...]} and a raw array
          const results: Array<Record<string, unknown>> = Array.isArray(parsed)
            ? parsed
            : parsed.results;
          if (!Array.isArray(results)) {
            throw new Error("Batch response missing results array");
          }

          const byIndex = new Map<number, Record<string, unknown>>();
          for (const r of results) {
            if (r && typeof r.index === "number") byIndex.set(r.index, r);
          }

          await Promise.all(
            batch.map(async (paper, i) => {
              const r = byIndex.get(i);
              if (!r) {
                sendError(paper, new Error("missing from batch response"));
                return;
              }
              const analysis = {
                tags: r.tags ?? [],
                model: r.model ?? "",
                variables: r.variables ?? "",
                method: r.method ?? "",
                contribution: r.contribution ?? "",
                dataSource: r.dataSource ?? "仅摘要",
              };
              try {
                await prisma.paper.update({
                  where: { id: paper.id },
                  data: { aiAnalysis: JSON.stringify(analysis) },
                });
                sendOk(paper, false);
              } catch (err) {
                sendError(paper, err);
              }
            })
          );
        },
        ABSTRACT_BATCH_CONCURRENCY,
        (_completed, _total, result) => {
          // Whole batch call failed — every paper in it counts as failed
          if (result.status === "rejected") {
            for (const paper of abstractBatches[result.index]) {
              sendError(paper, result.reason);
            }
          }
        },
        request.signal
      );

      await Promise.all([fullTextPool, abstractPool]);

      send({ type: "done", analyzed, failed, total: papers.length, withFullText });
      clearInterval(keepalive);
      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() {
      console.log("[batch-analyze] stream cancelled (client disconnected)");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    },
  });
}

export const maxDuration = 300;
