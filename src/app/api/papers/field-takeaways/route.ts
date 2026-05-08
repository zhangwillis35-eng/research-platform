import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import type { AnalysisEngine } from "@/components/analysis-engine-select";
import { streamFieldTakeaways } from "@/lib/research/field-analysis";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      projectId,
      paperIds,
      provider = "deepseek-fast",
      engine = "builtin",
    } = body as {
      projectId: string;
      paperIds?: string[];
      provider?: AIProvider;
      engine?: AnalysisEngine;
    };

    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;
    setAIContext(typeof auth === "object" && "id" in auth ? auth.id : "unknown", "/api/papers/field-takeaways");

    // Fetch papers with full text
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { projectId, fullText: { not: null } };
    if (paperIds?.length) {
      where.id = { in: paperIds };
    }

    const papers = await prisma.paper.findMany({
      where,
      select: {
        id: true, title: true, abstract: true, authors: true,
        year: true, venue: true, fullText: true,
        openAccessPdf: true, pdfUrl: true, doi: true,
      },
    });

    if (papers.length === 0) {
      return NextResponse.json(
        { error: "No papers with full text available" },
        { status: 400 }
      );
    }

    const notebookUrl: string | null = null;

    // Stream response
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "status", message: `正在使用 ${engine === "builtin" ? "AI" : engine.toUpperCase()} 生成领域要点...` })}\n\n`
          ));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fieldPapers = papers.map((p: any) => ({
            ...p,
            authors: p.authors as { name: string }[],
          }));

          const stream = streamFieldTakeaways(fieldPapers, engine, provider, notebookUrl);
          for await (const chunk of stream) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`
            ));
          }

          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "done" })}\n\n`
          ));
        } catch (err) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`
          ));
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
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
