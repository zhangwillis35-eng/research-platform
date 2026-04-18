import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/papers?projectId=xxx
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const papers = await prisma.paper.findMany({
    where: { projectId },
    orderBy: { citationCount: "desc" },
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
