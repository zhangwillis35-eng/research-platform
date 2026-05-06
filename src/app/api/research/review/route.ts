import {
  generateOutline,
  generateReviewStream,
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
    } = body as {
      topic: string;
      papers: UnifiedPaper[];
      perspectives?: string[];
      provider?: AIProvider;
      wordCount?: { min: number; max: number };
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
          // Phase 1: Generate outline
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "phase", phase: "outline", message: "正在生成综述大纲..." })}\n\n`
            )
          );

          const outline = await generateOutline(
            { topic, papers, perspectives, provider, wordCount }
          );

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "outline", outline })}\n\n`
            )
          );

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
