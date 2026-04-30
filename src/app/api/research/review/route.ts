import {
  generateOutline,
  generateReviewStream,
  runNotebookLMAnalysis,
} from "@/lib/research/storm-review";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";
import type { NotebookLMConfig } from "@/lib/integrations/notebooklm";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const body = await request.json();
    const {
      topic,
      papers,
      perspectives,
      provider = "gemini",
      notebookLM,
    } = body as {
      topic: string;
      papers: UnifiedPaper[];
      perspectives?: string[];
      provider?: AIProvider;
      notebookLM?: NotebookLMConfig | null;
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
          // Phase 0: NotebookLM deep analysis (if configured)
          let nlmInsights: string | undefined;
          if (notebookLM) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "phase", phase: "notebooklm", message: "正在通过 NotebookLM 分析全文..." })}\n\n`
              )
            );
            try {
              const nlmResult = await runNotebookLMAnalysis(
                topic,
                papers.length,
                notebookLM
              );
              nlmInsights = nlmResult.reviewInsights + "\n\n" + nlmResult.variableInsights;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "nlm_done", insights: nlmInsights.slice(0, 500) + "..." })}\n\n`
                )
              );
            } catch {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "nlm_skip", reason: "NotebookLM 不可用，使用摘要模式" })}\n\n`
                )
              );
            }
          }

          // Phase 1: Generate outline
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "phase", phase: "outline", message: "正在生成综述大纲..." })}\n\n`
            )
          );

          const outline = await generateOutline(
            { topic, papers, perspectives, provider },
            nlmInsights
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

          const stream = generateReviewStream(outline, papers, provider, nlmInsights);
          for await (const chunk of stream) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`
              )
            );
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "done", hasNLM: !!nlmInsights })}\n\n`
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
