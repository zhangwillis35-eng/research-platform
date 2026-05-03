import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { extractText, getMeta } from "unpdf";

/**
 * POST /api/papers/batch-upload — Fast batch PDF upload, text-only (no OSS).
 *
 * Accepts multipart/form-data with:
 *   - files[]: multiple PDF files
 *   - projectId: project ID
 *
 * Skips OSS upload to maximize throughput. Stores extracted text directly in DB.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const projectId = formData.get("projectId") as string | null;
    const files = formData.getAll("files[]") as File[];

    if (!projectId || files.length === 0) {
      return NextResponse.json({ error: "projectId and files[] required" }, { status: 400 });
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          if (!file.name.toLowerCase().endsWith(".pdf")) {
            return { name: file.name, ok: false, error: "not a PDF" };
          }

          const arrayBuffer = await file.arrayBuffer();
          const buffer = new Uint8Array(arrayBuffer);

          // Extract text
          const { text: fullText } = await extractText(buffer, { mergePages: true });
          if (!fullText || fullText.trim().length < 100) {
            return { name: file.name, ok: false, error: "could not extract text" };
          }

          // Extract PDF metadata (optional)
          let pdfTitle: string | undefined;
          let pdfAuthor: string | undefined;
          try {
            const meta = await getMeta(buffer);
            pdfTitle = meta.info?.Title as string | undefined;
            pdfAuthor = meta.info?.Author as string | undefined;
          } catch { /* optional */ }

          // Extract abstract
          const abstractMatch = fullText.match(
            /(?:abstract|摘\s*要)[:\s]*\n?([\s\S]{100,2000}?)(?:\n\s*(?:keywords|key\s*words|introduction|1[\s.]|关键词|引言))/i
          );
          const extractedAbstract = abstractMatch?.[1]?.trim();

          const title = pdfTitle?.trim() || file.name.replace(/\.pdf$/i, "");
          const authors = pdfAuthor
            ? pdfAuthor.split(/[,;，；]/).map((name: string) => ({ name: name.trim() }))
            : [];

          // Save to DB — no OSS upload
          await prisma.paper.create({
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

          return { name: file.name, ok: true };
        } catch (err) {
          return { name: file.name, ok: false, error: String(err) };
        }
      })
    );

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    return NextResponse.json({ succeeded, failed: failed.length, errors: failed });
  } catch (error) {
    console.error("[batch-upload] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export const maxDuration = 120;
