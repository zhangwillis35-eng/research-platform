import { smartSearch, type JournalLang } from "@/lib/research/smart-search";
import { setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { applyJournalFilter } from "@/lib/sources/journal-filter";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    setAIContext(auth.id, "/api/research/smart-search");
    const body = await request.json();
    const {
      query,
      provider = "deepseek-fast",
      limit = 20,
      enableRelevanceScoring = true,
      stream = false,
      projectId,
      journalLang = "en",
    } = body as {
      query: string;
      provider?: AIProvider;
      limit?: number;
      enableRelevanceScoring?: boolean;
      stream?: boolean;
      projectId?: string;
      journalLang?: JournalLang;
    };

    if (!query?.trim()) {
      return new Response(JSON.stringify({ error: "Query required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!stream) {
      // Non-streaming mode — backwards compatible JSON response
      const result = await smartSearch(query, provider, limit, enableRelevanceScoring, undefined, journalLang);
      if (projectId) {
        const { papers: filtered, removedCount } = await applyJournalFilter(projectId, result.papers);
        result.papers = filtered;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (result.stats) (result.stats as any).filteredByJournalFilter = removedCount;
      }
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Streaming mode — SSE with progressive results
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        function send(data: Record<string, unknown>) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        }

        // Keepalive ping every 15s — shorter interval survives stricter proxies
        const keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch { /* stream already closed */ }
        }, 15000);

        try {
          send({ type: "status", message: "AI 提取关键词中..." });

          const result = await smartSearch(
            query,
            provider,
            limit,
            enableRelevanceScoring,
            (phase, detail) => {
              send({ type: "status", phase, message: detail });
            },
            journalLang
          );

          // Apply journal filter if projectId provided
          if (projectId) {
            const { papers: filtered, removedCount } = await applyJournalFilter(projectId, result.papers);
            result.papers = filtered;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (result.stats) (result.stats as any).filteredByJournalFilter = removedCount;
            if (removedCount > 0) {
              send({ type: "status", phase: "journal-filter", message: `期刊过滤：排除 ${removedCount} 篇` });
            }
          }

          // Strip fullText from papers to save bandwidth
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const strippedPapers = result.papers.map((p: any) => {
            const { fullText, ...rest } = p;
            return rest;
          });

          // Send papers in chunks of 20 to avoid large single SSE frames
          // A single 100-paper JSON can exceed proxy/browser buffer limits
          const CHUNK_SIZE = 20;
          const totalChunks = Math.ceil(strippedPapers.length / CHUNK_SIZE);
          for (let i = 0; i < strippedPapers.length; i += CHUNK_SIZE) {
            send({
              type: "papers_chunk",
              papers: strippedPapers.slice(i, i + CHUNK_SIZE),
              chunkIndex: Math.floor(i / CHUNK_SIZE),
              totalChunks,
            });
          }

          // Send metadata + done signal separately
          send({
            type: "done",
            stats: result.stats,
            plan: result.plan,
            totalPapers: strippedPapers.length,
          });
        } catch (error) {
          send({
            type: "error",
            error: "Smart search failed",
            details: String(error),
          });
        }

        clearInterval(keepalive);
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",   // Disable nginx proxy buffering for SSE
      },
    });
  } catch (error) {
    console.error("Smart search error:", error);
    return new Response(
      JSON.stringify({ error: "Smart search failed", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const maxDuration = 300; // Increased: full-text fetching for quality tiers takes longer
