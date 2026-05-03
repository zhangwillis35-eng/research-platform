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

    // Check for existing paper with similar title
    const existing = await prisma.paper.findMany({
      where: { projectId },
      select: { id: true, title: true },
    });

    const norm = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
    let matchId: string | null = null;
    for (const p of existing) {
      const pNorm = p.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
      if (pNorm.length < 10 || norm.length < 10) continue;
      const shorter = Math.min(norm.length, pNorm.length);
      const longer = Math.max(norm.length, pNorm.length);
      if (pNorm.includes(norm) || norm.includes(pNorm) || shorter / longer > 0.85) {
        matchId = p.id;
        break;
      }
    }

    if (matchId) {
      await prisma.paper.update({
        where: { id: matchId },
        data: { fullText: fullText.slice(0, 30000), pdfFileName, ...(abstract ? { abstract } : {}) },
      });
      return NextResponse.json({ ok: true, matched: true, title });
    }

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
