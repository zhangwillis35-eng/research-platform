/**
 * Paper Q&A API — RAG-based question answering over uploaded PDFs.
 *
 * POST: Ask a question (SSE streaming)
 * PUT:  Index/re-index paper chunks for a project
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { answerQuestion, indexProjectPapers } from "@/lib/research/paper-qa";
import { prisma } from "@/lib/db";

export const maxDuration = 120;

// ─── POST: Ask a question ────────────────────────

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  setAIContext(auth.id, "/api/papers/qa");

  const body = await request.json();
  const {
    projectId,
    question,
    provider = "deepseek-fast",
    chatHistory = [],
  } = body as {
    projectId: string;
    question: string;
    provider?: AIProvider;
    chatHistory?: { role: string; content: string }[];
  };

  if (!projectId || !question?.trim()) {
    return NextResponse.json(
      { error: "projectId and question required" },
      { status: 400 },
    );
  }

  // Auto-index if no chunks exist yet
  const chunkCount = await prisma.paperChunk.count({ where: { projectId } });
  if (chunkCount === 0) {
    await indexProjectPapers(projectId);
  }

  // Stream the answer
  const encoder = new TextEncoder();
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        if (aborted) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          /* stream closed */
        }
      };

      const keepalive = setInterval(() => {
        if (!aborted) send({ type: "ping" });
      }, 15000);

      try {
        send({ type: "status", message: "正在检索相关文献段落..." });

        const gen = answerQuestion(projectId, question, provider, chatHistory);
        let fullText = "";

        for await (const chunk of gen) {
          if (aborted) break;
          fullText += chunk;
          send({ type: "text", text: chunk });
        }

        send({ type: "done", textLength: fullText.length });
      } catch (err) {
        send({ type: "error", error: String(err) });
      } finally {
        clearInterval(keepalive);
        if (!aborted) controller.close();
      }
    },
    cancel() {
      aborted = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── PUT: Index paper chunks ─────────────────────

export async function PUT(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  setAIContext(auth.id, "/api/papers/qa/index");

  const body = await request.json();
  const { projectId } = body as { projectId: string };

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId required" },
      { status: 400 },
    );
  }

  try {
    const result = await indexProjectPapers(projectId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[qa/index] Error:", error);
    return NextResponse.json(
      { error: "Index failed", details: String(error), stack: (error as Error).stack },
      { status: 500 },
    );
  }
}
