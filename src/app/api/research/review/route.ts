import { generateOutline, generateReviewStream } from "@/lib/research/storm-review";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      topic,
      papers,
      perspectives,
      provider = "gemini",
      phase = "full", // "outline" | "review" | "full"
    } = body as {
      topic: string;
      papers: UnifiedPaper[];
      perspectives?: string[];
      provider?: AIProvider;
      phase?: "outline" | "review" | "full";
    };

    if (!topic || !papers?.length) {
      return new Response(
        JSON.stringify({ error: "Topic and papers are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const perspectiveList = perspectives ?? [
      "理论视角",
      "实证方法视角",
      "应用情境视角",
      "批评与争议视角",
    ];

    // Phase 1: Generate outline
    const outline = await generateOutline(topic, papers, perspectiveList, provider);

    if (phase === "outline") {
      return new Response(JSON.stringify({ outline }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Phase 2: Stream full review
    const stream = generateReviewStream(outline, papers, provider);
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        // First send the outline
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "outline", outline })}\n\n`
          )
        );

        try {
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
