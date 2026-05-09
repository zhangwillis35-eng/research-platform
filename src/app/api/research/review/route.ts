import {
  generateOutline,
  generateReviewStream,
  type ReviewOutline,
} from "@/lib/research/storm-review";
import { setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    setAIContext(auth.id, "/api/research/review");
    const body = await request.json();
    const {
      topic,
      papers,
      perspectives,
      provider = "deepseek-fast",
      wordCount,
      outlineOnly = false,
      outline: providedOutline,
      stormContext,
    } = body as {
      topic: string;
      papers: UnifiedPaper[];
      perspectives?: string[];
      provider?: AIProvider;
      wordCount?: { min: number; max: number };
      outlineOnly?: boolean;
      outline?: ReviewOutline;
      stormContext?: string;
    };

    if (!topic || !papers?.length) {
      return new Response(
        JSON.stringify({ error: "Topic and papers are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        // Keepalive: prevent SSE timeout during long generation phases
        const keepalive = setInterval(() => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`)); } catch { /* closed */ }
        }, 10000);

        try {
          let outline: ReviewOutline;

          if (providedOutline) {
            outline = providedOutline;
          } else {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "phase", phase: "outline", message: "正在生成综述大纲..." })}\n\n`
              )
            );

            outline = await generateOutline(
              { topic, papers, perspectives, provider, wordCount }
            );
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "outline", outline })}\n\n`
            )
          );

          if (outlineOnly) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "done" })}\n\n`
              )
            );
            clearInterval(keepalive);
            controller.close();
            return;
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "phase", phase: "writing", message: "正在撰写综述..." })}\n\n`
            )
          );

          const stream = generateReviewStream(outline, papers, provider, wordCount, stormContext);
          for await (const chunk of stream) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`
              )
            );
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "done" })}\n\n`
            )
          );
        } catch (err) {
          console.error("[review] Generation error:", err);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`
            )
          );
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
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Review generation failed", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const maxDuration = 300;
