import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { extractText, getMeta } from "unpdf";
import { uploadPdf, pdfKey } from "@/lib/oss";

/**
 * POST /api/papers/upload — Upload a PDF, extract text, store in OSS.
 *
 * Accepts multipart/form-data with:
 *   - file: PDF file
 *   - projectId: project ID
 *   - paperId: (optional) existing paper ID to attach fullText to
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string | null;
    const paperId = formData.get("paperId") as string | null;

    if (!file || !projectId) {
      return NextResponse.json(
        { error: "file and projectId required" },
        { status: 400 }
      );
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF files are supported" },
        { status: 400 }
      );
    }

    // Read PDF buffer — copy to avoid detached ArrayBuffer after extractText
    const arrayBuffer = await file.arrayBuffer();
    const pdfBytes = Buffer.from(arrayBuffer);
    const buffer = new Uint8Array(pdfBytes);

    // Extract text
    let { text: fullText } = await extractText(buffer, { mergePages: true });
    // Strip null bytes — PostgreSQL TEXT rejects \x00
    if (fullText) fullText = fullText.replace(/\x00/g, "");

    if (!fullText || fullText.trim().length < 50) {
      return NextResponse.json(
        { error: "文本过少，可能是扫描版 PDF 或加密文档" },
        { status: 422 }
      );
    }

    // Extract metadata
    let pdfTitle: string | undefined;
    let pdfAuthor: string | undefined;
    try {
      const meta = await getMeta(buffer);
      pdfTitle = meta.info?.Title as string | undefined;
      pdfAuthor = meta.info?.Author as string | undefined;
    } catch { /* metadata extraction is optional */ }

    // Try to extract abstract from the full text
    const abstractMatch = fullText.match(
      /(?:abstract|摘\s*要)[:\s]*\n?([\s\S]{100,2000}?)(?:\n\s*(?:keywords|key\s*words|introduction|1[\s.]|关键词|引言))/i
    );
    const extractedAbstract = abstractMatch?.[1]?.trim();

    if (paperId) {
      // Upload PDF to OSS
      const key = pdfKey(projectId, paperId, file.name);
      const ossKey = await uploadPdf(key, pdfBytes);

      // Attach fullText + OSS key to existing paper
      const paper = await prisma.paper.update({
        where: { id: paperId },
        data: {
          fullText: fullText.trim(),
          pdfFileName: file.name,
          pdfOssKey: ossKey,
          // Keep pdfData as fallback if OSS upload failed
          ...(ossKey ? { pdfData: null } : { pdfData: pdfBytes }),
        },
      });

      return NextResponse.json({
        paper,
        textLength: fullText.length,
        wordCount: fullText.split(/\s+/).length,
      });
    }

    // Create new paper first to get ID
    const title = pdfTitle || file.name.replace(/\.pdf$/i, "");
    const authors = pdfAuthor
      ? pdfAuthor.split(/[,;，；]/).map((name: string) => ({ name: name.trim() }))
      : [];

    const paper = await prisma.paper.create({
      data: {
        projectId,
        title,
        abstract: extractedAbstract ?? fullText.slice(0, 500),
        authors,
        source: "manual",
        citationCount: 0,
        referenceCount: 0,
        fullText: fullText.trim(),
        pdfFileName: file.name,
      },
    });

    // Upload PDF to OSS
    const key = pdfKey(projectId, paper.id, file.name);
    const ossKey = await uploadPdf(key, pdfBytes);

    // Update paper with OSS key (or fallback to pdfData)
    await prisma.paper.update({
      where: { id: paper.id },
      data: ossKey
        ? { pdfOssKey: ossKey }
        : { pdfData: pdfBytes },
    });

    return NextResponse.json({
      paper: { ...paper, pdfOssKey: ossKey },
      textLength: fullText.length,
      wordCount: fullText.split(/\s+/).length,
    });
  } catch (error) {
    console.error("[upload] PDF processing error:", error);
    return NextResponse.json(
      { error: "PDF processing failed", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
