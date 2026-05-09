import { NextResponse } from "next/server";
import {
  checkStormAvailable,
  runStormAnalysis,
  type StormPaper,
  type StormMode,
} from "@/lib/integrations/storm";

/**
 * POST /api/integrations/storm
 *
 * Actions:
 *   - check: verify STORM is installed (JSON response)
 *   - analyze: run STORM analysis (SSE stream with keepalive to prevent timeout)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, ...payload } = body as {
      action: "check" | "analyze";
      [key: string]: unknown;
    };

    if (action === "check") {
      const status = await checkStormAvailable();
      return NextResponse.json(status);
    }

    if (action === "analyze") {
      const topic = payload.topic as string;
      const papers = payload.papers as StormPaper[];
      const mode = (payload.mode as StormMode) ?? "review";

      if (!topic || !papers?.length) {
        return NextResponse.json(
          { error: "topic and papers required" },
          { status: 400 }
        );
      }

      // SSE stream with keepalive — STORM subprocess runs 30-120s
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const keepalive = setInterval(() => {
            try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`)); } catch { /* closed */ }
          }, 5000);

          try {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: "status", message: "STORM 分析中..." })}\n\n`
            ));

            const result = await runStormAnalysis(topic, papers, { mode });

            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: "result", ...result })}\n\n`
            ));
          } catch (err) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`
            ));
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
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("[storm-api] Error:", error);
    return NextResponse.json(
      { error: "STORM error", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
