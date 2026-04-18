import { streamAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      provider = "gemini",
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
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      system,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          let result = await stream.next();
          while (!result.done) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: result.value })}\n\n`)
            );
            result = await stream.next();
          }
          // Send final message with metadata
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, provider: result.value.provider, model: result.value.model })}\n\n`
            )
          );
          controller.close();
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: String(err) })}\n\n`
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
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "AI request failed", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
