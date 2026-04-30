import { smartSearch } from "@/lib/research/smart-search";
import { setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    setAIContext(auth.id, "/api/research/smart-search");
    const body = await request.json();
    const {
      query,
      provider = "gemini",
      limit = 20,
      enableRelevanceScoring = true,
      stream = false,
    } = body as {
      query: string;
      provider?: AIProvider;
      limit?: number;
      enableRelevanceScoring?: boolean;
      stream?: boolean;
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

          // Send final result
          send({ type: "result", ...result });
          send({ type: "done" });
        } catch (error) {
          send({
            type: "error",
            error: "Smart search failed",
            details: String(error),
          });
        }

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

export const maxDuration = 120;
