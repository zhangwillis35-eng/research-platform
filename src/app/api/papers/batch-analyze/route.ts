import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { concurrentPool } from "@/lib/concurrent-pool";
import { batchFetchFullText } from "@/lib/research/fulltext-fetcher";

const MAX_CONCURRENCY = 100;
const FULLTEXT_CONCURRENCY = 20;
const DEFAULT_PROVIDER: AIProvider = "deepseek-fast";

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

function buildPrompt(paper: {
  title: string;
  abstract: string | null;
  authors: unknown;
  year: number | null;
  venue: string | null;
  citationCount: number;
}, fullText?: string) {
  const authors =
    (paper.authors as Array<{ name: string }>)
      ?.slice(0, 3)
      .map((a) => a.name)
      .join(", ") ?? "";

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
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
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

      const withFullText = [...fullTextMap.values()].filter((ft) => ft.text.length > 300).length;
      send({
        type: "status",
        message: `全文获取完成: ${withFullText}/${papers.length} 篇有全文，开始 AI 深度分析 (${poolSize} 并发, ${aiProvider})...`,
      });

      // Phase 3: Concurrent AI analysis with full text
      let analyzed = 0;
      let failed = 0;

      await concurrentPool(
        papers,
        async (paper) => {
          const key = paper.doi || paper.title;
          const ft = fullTextMap.get(key);
          const hasFullText = ft && ft.text.length > 300;

          const result = await callAI({
            provider: aiProvider,
            messages: [
              {
                role: "user",
                content: buildPrompt(paper, ft?.text),
              },
            ],
            system: hasFullText ? SYSTEM_PROMPT_FULLTEXT : SYSTEM_PROMPT_ABSTRACT,
            jsonMode: true,
            noThinking: true,
            temperature: 0.1,
            maxTokens: hasFullText ? 1500 : 800,
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
        (completed, total, result) => {
          if (result.status === "fulfilled") {
            analyzed++;
            const key = papers[result.index].doi || papers[result.index].title;
            const ft = fullTextMap.get(key);
            send({
              type: "progress",
              completed,
              total,
              paperId: papers[result.index].id,
              title: papers[result.index].title.slice(0, 60),
              status: "ok",
              hasFullText: !!(ft && ft.text.length > 300),
            });
          } else {
            failed++;
            const errMsg =
              result.reason instanceof Error
                ? result.reason.message.slice(0, 120)
                : String(result.reason).slice(0, 120);
            send({
              type: "progress",
              completed,
              total,
              paperId: papers[result.index].id,
              title: papers[result.index].title.slice(0, 60),
              status: "error",
              error: errMsg,
            });
          }
        }
      );

      send({ type: "done", analyzed, failed, total: papers.length, withFullText });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const maxDuration = 300;
