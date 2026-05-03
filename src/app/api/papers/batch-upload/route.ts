import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseHeaderWithGrobid, isGrobidAvailable } from "@/lib/sources/grobid";
import { extractText, getMeta } from "unpdf";

/**
 * POST /api/papers/batch-upload
 *
 * Fast batch PDF upload:
 *   - GROBID processHeaderDocument (title/authors/abstract, ~1-2s) runs in parallel with
 *   - unpdf extractText (full body text, ~0.1-0.5s)
 *   - fullText truncated to 30,000 chars before DB write
 *   - Smart title matching: attach to existing catalog paper if found, else create new
 *
 * Accepts multipart/form-data:
 *   - files[]: PDF files (keep ≤5 per request for best performance)
 *   - projectId: project ID
 */

const FULLTEXT_MAX = 30_000;
const CONCURRENCY = 4;

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

    // Preload existing catalog papers for title matching
    const existingPapers = await prisma.paper.findMany({
      where: { projectId },
      select: { id: true, title: true, fullText: true },
    });

    const results: Array<{ name: string; ok: boolean; matched: boolean; error?: string }> = [];

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((file) => processOne(file, projectId, grobidOk, existingPapers))
      );
      results.push(...batchResults);
    }

    const succeeded = results.filter((r) => r.ok).length;
    const matched = results.filter((r) => r.ok && r.matched).length;
    const created = results.filter((r) => r.ok && !r.matched).length;
    const failed = results.filter((r) => !r.ok);

    return NextResponse.json({ succeeded, matched, created, failed: failed.length, errors: failed, grobid: grobidOk });
  } catch (error) {
    console.error("[batch-upload] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function findMatch(
  title: string,
  existingPapers: Array<{ id: string; title: string; fullText: string | null }>
): { id: string } | null {
  const norm = normalizeTitle(title);
  if (norm.length < 10) return null;
  for (const p of existingPapers) {
    const pNorm = normalizeTitle(p.title);
    if (pNorm.length < 10) continue;
    const shorter = Math.min(norm.length, pNorm.length);
    const longer = Math.max(norm.length, pNorm.length);
    if (pNorm.includes(norm) || norm.includes(pNorm) || shorter / longer > 0.85) {
      return { id: p.id };
    }
  }
  return null;
}

async function processOne(
  file: File,
  projectId: string,
  useGrobid: boolean,
  existingPapers: Array<{ id: string; title: string; fullText: string | null }>
): Promise<{ name: string; ok: boolean; matched: boolean; error?: string }> {
  try {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return { name: file.name, ok: false, matched: false, error: "not a PDF" };
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const nodeBuf = Buffer.from(arrayBuffer);

    // Run header parsing and text extraction in parallel
    const [headerResult, textResult] = await Promise.allSettled([
      useGrobid ? parseHeaderWithGrobid(nodeBuf) : Promise.resolve(null),
      extractText(uint8, { mergePages: true }).catch(() => ({ text: "" })),
    ]);

    const header = headerResult.status === "fulfilled" ? headerResult.value : null;
    const rawText = textResult.status === "fulfilled" ? textResult.value.text ?? "" : "";

    if (!rawText || rawText.trim().length < 100) {
      return { name: file.name, ok: false, matched: false, error: "could not extract text" };
    }

    // Truncate fullText — we only send 5-8k to LLM anyway; 30k covers all use cases
    const fullText = rawText.trim().slice(0, FULLTEXT_MAX);

    // Metadata: prefer GROBID header, fall back to PDF metadata, then filename
    let title: string | undefined = header?.title?.trim();
    let abstract: string | undefined = header?.abstract?.trim();
    let authors: { name: string }[] = header?.authors?.map((n) => ({ name: n })) ?? [];

    if (!title || authors.length === 0) {
      try {
        const meta = await getMeta(uint8);
        if (!title) title = (meta.info?.Title as string | undefined)?.trim();
        if (authors.length === 0) {
          const pdfAuthor = meta.info?.Author as string | undefined;
          if (pdfAuthor) {
            authors = pdfAuthor.split(/[,;，；]/).map((n: string) => ({ name: n.trim() })).filter((a) => a.name.length > 1);
          }
        }
      } catch { /* optional */ }
    }

    if (!abstract) {
      const m = rawText.match(
        /(?:abstract|摘\s*要)[:\s]*\n?([\s\S]{100,2000}?)(?:\n\s*(?:keywords|key\s*words|introduction|1[\s.]|关键词|引言))/i
      );
      abstract = m?.[1]?.trim();
    }

    const finalTitle = title || file.name.replace(/\.pdf$/i, "");

    // Smart match: attach to existing paper or create new
    const match = findMatch(finalTitle, existingPapers);
    if (match) {
      await prisma.paper.update({
        where: { id: match.id },
        data: { fullText, pdfFileName: file.name, ...(abstract ? { abstract } : {}) },
      });
      return { name: file.name, ok: true, matched: true };
    }

    await prisma.paper.create({
      data: {
        projectId,
        title: finalTitle,
        abstract: abstract ?? fullText.slice(0, 500),
        authors,
        source: "manual",
        citationCount: 0,
        referenceCount: 0,
        fullText,
        pdfFileName: file.name,
      },
    });

    return { name: file.name, ok: true, matched: false };
  } catch (err) {
    return { name: file.name, ok: false, matched: false, error: String(err) };
  }
}

export const maxDuration = 120;
