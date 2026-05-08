import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import {
  translatePaperStream,
  extractAndVerifyTerms,
  analyzePaper,
} from "@/lib/research/paper-translator";

export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  setAIContext(auth.id, "/api/research/translate");

  let body: {
    action: "translate" | "extract-terms" | "analyze";
    text: string;
    title?: string;
    provider?: AIProvider;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, text, title = "", provider = "deepseek-fast" } = body;

  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  // ── Streaming actions ──────────────────────────────────────────────────
  if (action === "translate") {
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of translatePaperStream(text, title, provider)) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ phase: "error", error: String(err) })}\n\n`
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
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ── Blocking actions ───────────────────────────────────────────────────
  if (action === "extract-terms") {
    const terms = await extractAndVerifyTerms(text, title, provider);
    return NextResponse.json({ terms });
  }

  if (action === "analyze") {
    const analysis = await analyzePaper(text, title, provider);
    if (!analysis) {
      return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
    }
    return NextResponse.json({ analysis });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
