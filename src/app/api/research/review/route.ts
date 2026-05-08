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
    } = body as {
      topic: string;
      papers: UnifiedPaper[];
      perspectives?: string[];
      provider?: AIProvider;
      wordCount?: { min: number; max: number };
      outlineOnly?: boolean;
      outline?: ReviewOutline;
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
        try {
          let outline: ReviewOutline;

          if (providedOutline) {
            // Skip Phase 1 — use the caller-supplied (possibly user-edited) outline
            outline = providedOutline;
          } else {
            // Phase 1: Generate outline
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

          // If outlineOnly mode, stop here and let the user review/edit the outline
          if (outlineOnly) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "done" })}\n\n`
              )
            );
            controller.close();
            return;
          }

          // Phase 2: Stream full review
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "phase", phase: "writing", message: "正在撰写综述..." })}\n\n`
            )
          );

          const stream = generateReviewStream(outline, papers, provider, wordCount);
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
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`
            )
          );
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
    return new Response(
      JSON.stringify({ error: "Review generation failed", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const maxDuration = 120;
