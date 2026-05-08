import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSignedUrl } from "@/lib/oss";
import { extractImagesFromPdf } from "@/lib/pdf-images";

export const maxDuration = 120;

/**
 * POST /api/research/translate/images
 * Body JSON: { paperId: string }
 *
 * Fetches the paper's PDF (from OSS or DB), extracts embedded images
 * via MuPDF WASM, and returns them as base64 PNG.
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { paperId } = await request.json();
  if (!paperId) {
    return NextResponse.json({ error: "paperId required" }, { status: 400 });
  }

  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: { pdfOssKey: true, pdfData: true, pdfFileName: true },
  });

  if (!paper) {
    return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  }

  // Get PDF bytes
  let pdfBytes: Uint8Array | null = null;

  if (paper.pdfOssKey) {
    const url = getSignedUrl(paper.pdfOssKey);
    if (url) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          pdfBytes = new Uint8Array(await res.arrayBuffer());
        }
      } catch {
        // fall through to pdfData
      }
    }
  }

  if (!pdfBytes && paper.pdfData) {
    pdfBytes = new Uint8Array(paper.pdfData);
  }

  if (!pdfBytes) {
    return NextResponse.json({ error: "No PDF available" }, { status: 404 });
  }

  try {
    const images = await extractImagesFromPdf(pdfBytes, 20);

    // Convert to base64 for JSON transport (limit total size)
    const result = images.map((img) => ({
      label: img.label,
      page: img.page,
      width: img.width,
      height: img.height,
      base64: Buffer.from(img.png).toString("base64"),
    }));

    return NextResponse.json({ images: result });
  } catch (err) {
    console.error("[translate/images] MuPDF extraction error:", err);
    return NextResponse.json(
      { error: "Image extraction failed", details: String(err) },
      { status: 500 }
    );
  }
}
