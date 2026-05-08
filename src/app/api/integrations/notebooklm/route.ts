import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  checkNotebookLM,
  batchImportToNotebookLM,
  askNotebookLM,
  listNotebookLMNotebooks,
} from "@/lib/integrations/notebooklm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, projectId } = body as {
      action: string;
      projectId?: string;
    };

    // Check action — some don't need projectId
    if (action === "check") {
      const status = await checkNotebookLM();
      return NextResponse.json(status);
    }

    if (action === "list-notebooks") {
      const notebooks = await listNotebookLMNotebooks();
      return NextResponse.json({ notebooks });
    }

    // All other actions need projectId
    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;

    const project = await prisma.researchProject.findUnique({
      where: { id: projectId },
      select: { notebookUrl: true },
    });

    const notebookUrl = project?.notebookUrl;
    if (!notebookUrl) {
      return NextResponse.json(
        { error: "NotebookLM notebook URL not configured. Set it in project Settings." },
        { status: 400 }
      );
    }

    if (action === "batch-import") {
      // Optionally accept paperIds to import specific papers, or import all
      const { paperIds } = body as { paperIds?: string[] };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { projectId };
      if (paperIds?.length) {
        where.id = { in: paperIds };
      }

      const papers = await prisma.paper.findMany({
        where,
        select: { openAccessPdf: true, pdfUrl: true, doi: true, title: true },
      });

      // Build URL list: prefer openAccessPdf > pdfUrl > DOI link
      const urls = papers
        .map((p) => p.openAccessPdf || p.pdfUrl || (p.doi ? `https://doi.org/${p.doi}` : null))
        .filter((u): u is string => !!u);

      if (urls.length === 0) {
        return NextResponse.json(
          { error: "No papers with accessible URLs found" },
          { status: 400 }
        );
      }

      // Stream progress via SSE
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: "status", message: `准备导入 ${urls.length} 篇文献到 NotebookLM...` })}\n\n`
            ));

            const result = await batchImportToNotebookLM(notebookUrl, urls);

            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: "result", ...result })}\n\n`
            ));
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
    }

    if (action === "ask") {
      const { question, sessionId } = body as {
        question: string;
        sessionId?: string;
      };

      if (!question?.trim()) {
        return NextResponse.json({ error: "question required" }, { status: 400 });
      }

      const result = await askNotebookLM(notebookUrl, question, sessionId);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
