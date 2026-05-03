import { smartSearch } from "@/lib/research/smart-search";
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
    } = body as {
      query: string;
      provider?: AIProvider;
      limit?: number;
      enableRelevanceScoring?: boolean;
      stream?: boolean;
      projectId?: string;
    };

    if (!query?.trim()) {
      return new Response(JSON.stringify({ error: "Query required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!stream) {
      // Non-streaming mode — backwards compatible JSON response
      const result = await smartSearch(query, provider, limit, enableRelevanceScoring);
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

        // Keepalive ping every 30s to prevent nginx proxy_read_timeout (300s)
        const keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch { /* stream already closed */ }
        }, 30000);

        try {
          send({ type: "status", message: "AI 提取关键词中..." });

          const result = await smartSearch(
            query,
            provider,
            limit,
            enableRelevanceScoring,
            (phase, detail) => {
              send({ type: "status", phase, message: detail });
            }
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

          // Send final result — strip fullText to save bandwidth (hasFullText flag is preserved)
          const strippedResult = {
            ...result,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            papers: result.papers.map((p: any) => {
              const { fullText, ...rest } = p;
              return rest;
            }),
          };
          send({ type: "result", ...strippedResult });
          send({ type: "done" });
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
        Connection: "keep-alive",
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
