import { streamAI, setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { batchStream } from "@/lib/batch-stream";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    setAIContext(auth.id, "/api/ai/chat");
    const body = await request.json();
    const {
      provider = "deepseek-fast",
      messages,
      system,
    } = body as {
      provider?: AIProvider;
      messages: { role: string; content: string }[];
      system?: string;
    };

    if (!messages?.length) {
      return new Response(JSON.stringify({ error: "Messages required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const stream = streamAI({
      provider,
      signal: request.signal,
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      system,
      noThinking: true,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
          const keepalive = setInterval(() => {
            try { controller.enqueue(encoder.encode(`: keepalive

`)); } catch { /* closed */ }
          }, 10000);
        try {
          for await (const chunk of batchStream(stream, 30)) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`)
            );
          }
          // Send final message with metadata
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true })}\n\n`
            )
          );
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: String(err) })}\n\n`
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
      JSON.stringify({ error: "AI request failed", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const maxDuration = 300;
