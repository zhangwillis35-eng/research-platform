import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/papers?projectId=xxx&source=catalog|weekly|fulltext
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const source = searchParams.get("source"); // "catalog" | "weekly" | "fulltext"

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  // Build filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { projectId };

  if (source === "fulltext") {
    // Only papers with uploaded PDF full text, excluding weekly digest
    where.fullText = { not: null };
    where.OR = [
      { folder: null },
      { folder: { not: { contains: "AI 前沿" } } },
    ];
  } else if (source === "catalog") {
    // All non-weekly papers (folder is null OR folder doesn't contain "AI 前沿")
    where.OR = [
      { folder: null },
      { folder: { not: { contains: "AI 前沿" } } },
    ];
  } else if (source === "weekly") {
    where.folder = { contains: "AI 前沿" };
  }

  // Exclude pdfData from list queries (binary, too large)
  const papers = await prisma.paper.findMany({
    where,
    orderBy: { citationCount: "desc" },
    omit: { pdfData: true },
  });

  return NextResponse.json({ papers });
}

// POST /api/papers — add paper to project
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectId, ...paperData } = body;

    if (!projectId || !paperData.title) {
      return NextResponse.json({ error: "projectId and title required" }, { status: 400 });
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;

    const paper = await prisma.paper.create({
      data: {
        projectId,
        title: paperData.title,
        abstract: paperData.abstract,
        authors: paperData.authors ?? [],
        year: paperData.year,
        venue: paperData.venue,
        citationCount: paperData.citationCount ?? 0,
        referenceCount: paperData.referenceCount ?? 0,
        doi: paperData.doi,
        externalId: paperData.externalId,
        source: paperData.source ?? "manual",
        pdfUrl: paperData.pdfUrl,
        openAccessPdf: paperData.openAccessPdf,
        fieldsOfStudy: paperData.fieldsOfStudy,
        isSelected: paperData.isSelected ?? false,
      },
    });

    return NextResponse.json({ paper });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to add paper", details: String(error) },
      { status: 500 }
    );
  }
}
