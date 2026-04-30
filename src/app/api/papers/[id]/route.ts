import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSignedUrl } from "@/lib/oss";

// GET /api/papers/[id]?pdf=true — download stored PDF
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);

  if (searchParams.get("pdf") === "true") {
    const paper = await prisma.paper.findUnique({
      where: { id },
      select: { pdfData: true, pdfFileName: true, pdfOssKey: true },
    });

    if (!paper) {
      return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    }

    // Prefer OSS → redirect to signed URL
    if (paper.pdfOssKey) {
      const url = getSignedUrl(paper.pdfOssKey);
      if (url) {
        return NextResponse.redirect(url);
      }
    }

    // Fallback: serve from DB
    if (paper.pdfData) {
      return new Response(paper.pdfData, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${paper.pdfFileName ?? "paper.pdf"}"`,
        },
      });
    }

    return NextResponse.json({ error: "No PDF stored" }, { status: 404 });
  }

  // Default: return paper metadata
  const paper = await prisma.paper.findUnique({
    where: { id },
    select: {
      id: true, title: true, abstract: true, authors: true, year: true,
      venue: true, doi: true, citationCount: true, pdfFileName: true,
      fullText: true, tags: true, folder: true, isSelected: true,
    },
  });

  return NextResponse.json({ paper });
}

// DELETE /api/papers/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  await prisma.paper.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

// PUT /api/papers/[id] — toggle selected, update notes
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();

  const paper = await prisma.paper.update({
    where: { id },
    data: {
      isSelected: body.isSelected,
      notes: body.notes,
    },
  });

  return NextResponse.json({ paper });
}
