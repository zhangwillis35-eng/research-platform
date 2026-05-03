import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/papers/batch-upload-text — receive pre-extracted text (no PDF binary).
 *
 * Used by scripts/local-pdf-import.mjs for fast local-first imports.
 * Body: JSON { projectId, title, abstract, fullText, pdfFileName, authors }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectId, title, abstract, fullText, pdfFileName, authors } = body;

    if (!projectId || !title || !fullText) {
      return NextResponse.json({ error: "projectId, title, fullText required" }, { status: 400 });
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;

    // Always create a new paper entry (no fuzzy matching — avoids false positives)
    await prisma.paper.create({
      data: {
        projectId,
        title,
        abstract: abstract ?? fullText.slice(0, 500),
        authors: authors ?? [],
        source: "manual",
        citationCount: 0,
        referenceCount: 0,
        fullText: fullText.slice(0, 30000),
        pdfFileName,
      },
    });

    return NextResponse.json({ ok: true, matched: false, title });
  } catch (error) {
    console.error("[batch-upload-text] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
