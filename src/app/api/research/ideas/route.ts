import { NextResponse } from "next/server";
import { runIdeaPipelineStream } from "@/lib/research/idea-pipeline";
import { setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";
import { requireAuth } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  setAIContext(auth.id, "/api/research/ideas");

  let body: {
    papers: UnifiedPaper[];
    provider?: AIProvider;
    withPeerReview?: boolean;
    engineContext?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    papers,
    provider = "deepseek-fast",
    withPeerReview = true,
    engineContext = "",
  } = body;

  if (!papers?.length) {
    return NextResponse.json(
      { error: "Papers are required" },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
          const keepalive = setInterval(() => {
            try { controller.enqueue(encoder.encode(`: keepalive

`)); } catch { /* closed */ }
          }, 10000);
      try {
        for await (const event of runIdeaPipelineStream(
          papers,
          provider,
          withPeerReview,
          engineContext
        )) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        }
        clearInterval(keepalive);
        controller.close();
      } catch (err) {
        console.error("[ideas] Pipeline error:", err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ phase: "error", error: String(err) })}\n\n`
          )
        );
        controller.close();
      }
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
}
