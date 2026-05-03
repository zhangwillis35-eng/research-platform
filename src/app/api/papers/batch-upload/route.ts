import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseWithGrobid, isGrobidAvailable } from "@/lib/sources/grobid";
import { extractText, getMeta } from "unpdf";

/**
 * POST /api/papers/batch-upload — Fast batch PDF upload using GROBID.
 *
 * GROBID (local Docker sidecar) extracts structured title, abstract, authors,
 * sections, and references from academic PDFs — no OSS latency.
 *
 * Falls back to unpdf if GROBID is unavailable.
 *
 * Accepts multipart/form-data:
 *   - files[]: multiple PDF files
 *   - projectId: project ID
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

    const grobidOk = await isGrobidAvailable();
    console.log(`[batch-upload] GROBID available: ${grobidOk}, files: ${files.length}`);

    // Process concurrently — cap at 4 to avoid overwhelming GROBID (768MB heap)
    const CONCURRENCY = 4;
    const results: Array<{ name: string; ok: boolean; error?: string }> = [];

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map((file) => processOne(file, projectId, grobidOk)));
      results.push(...batchResults);
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    return NextResponse.json({ succeeded, failed: failed.length, errors: failed, grobid: grobidOk });
  } catch (error) {
    console.error("[batch-upload] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function processOne(
  file: File,
  projectId: string,
  useGrobid: boolean
): Promise<{ name: string; ok: boolean; error?: string }> {
  try {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return { name: file.name, ok: false, error: "not a PDF" };
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let title: string | undefined;
    let abstract: string | undefined;
    let fullText: string;
    let authors: { name: string }[] = [];

    if (useGrobid) {
      // GROBID: ML-based structured extraction (local, fast, high quality)
      const parsed = await parseWithGrobid(buffer);
      if (parsed && parsed.fullText.length > 100) {
        title = parsed.title;
        abstract = parsed.abstract;
        fullText = parsed.fullText;
        authors = parsed.authors.map((name) => ({ name }));
      } else {
        // GROBID failed for this file, fall back to unpdf
        return await extractWithUnpdf(file, arrayBuffer, projectId);
      }
    } else {
      return await extractWithUnpdf(file, arrayBuffer, projectId);
    }

    // Supplement with PDF metadata if GROBID didn't find authors/title
    if (authors.length === 0 || !title) {
      try {
        const uint8 = new Uint8Array(arrayBuffer);
        const meta = await getMeta(uint8);
        if (authors.length === 0) {
          const pdfAuthor = meta.info?.Author as string | undefined;
          if (pdfAuthor) {
            authors = pdfAuthor.split(/[,;，；]/).map((name: string) => ({ name: name.trim() })).filter(a => a.name.length > 1);
          }
        }
        if (!title) {
          title = (meta.info?.Title as string | undefined)?.trim();
        }
      } catch { /* optional */ }
    }

    const finalTitle = title?.trim() || file.name.replace(/\.pdf$/i, "");

    await prisma.paper.create({
      data: {
        projectId,
        title: finalTitle,
        abstract: abstract ?? fullText.slice(0, 500),
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
}

async function extractWithUnpdf(
  file: File,
  arrayBuffer: ArrayBuffer,
  projectId: string
): Promise<{ name: string; ok: boolean; error?: string }> {
  try {
    const buffer = new Uint8Array(arrayBuffer);
    const { text: fullText } = await extractText(buffer, { mergePages: true });

    if (!fullText || fullText.trim().length < 100) {
      return { name: file.name, ok: false, error: "could not extract text" };
    }

    let pdfTitle: string | undefined;
    let authors: { name: string }[] = [];
    try {
      const meta = await getMeta(buffer);
      pdfTitle = (meta.info?.Title as string | undefined)?.trim();
      const pdfAuthor = meta.info?.Author as string | undefined;
      if (pdfAuthor) {
        authors = pdfAuthor.split(/[,;，；]/).map((name: string) => ({ name: name.trim() })).filter(a => a.name.length > 1);
      }
    } catch { /* optional */ }

    const abstractMatch = fullText.match(
      /(?:abstract|摘\s*要)[:\s]*\n?([\s\S]{100,2000}?)(?:\n\s*(?:keywords|key\s*words|introduction|1[\s.]|关键词|引言))/i
    );

    await prisma.paper.create({
      data: {
        projectId,
        title: pdfTitle || file.name.replace(/\.pdf$/i, ""),
        abstract: abstractMatch?.[1]?.trim() ?? fullText.slice(0, 500),
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
}

export const maxDuration = 120;
