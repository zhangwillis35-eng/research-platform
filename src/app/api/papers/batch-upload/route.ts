import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseWithGrobid, isGrobidAvailable } from "@/lib/sources/grobid";
import { extractText, getMeta } from "unpdf";

/**
 * POST /api/papers/batch-upload — Smart batch PDF upload using GROBID.
 *
 * For each PDF:
 *   1. Extract title via GROBID (falls back to unpdf)
 *   2. Fuzzy-match title against existing catalog papers
 *   3a. Match found → attach fullText to existing paper
 *   3b. No match → create new paper entry
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

    // Preload all existing catalog papers for this project (title matching)
    const existingPapers = await prisma.paper.findMany({
      where: { projectId },
      select: { id: true, title: true, fullText: true },
    });

    const CONCURRENCY = 4;
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

    return NextResponse.json({
      succeeded,
      matched,   // attached to existing papers
      created,   // new entries created
      failed: failed.length,
      errors: failed,
      grobid: grobidOk,
    });
  } catch (error) {
    console.error("[batch-upload] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** Normalize title for fuzzy matching */
function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

/** Find existing paper with similar title (>80% overlap) */
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
    // Exact substring or high overlap
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
    const buffer = Buffer.from(arrayBuffer);

    let title: string | undefined;
    let abstract: string | undefined;
    let fullText: string;
    let authors: { name: string }[] = [];

    if (useGrobid) {
      const parsed = await parseWithGrobid(buffer);
      if (parsed && parsed.fullText.length > 100) {
        title = parsed.title;
        abstract = parsed.abstract;
        fullText = parsed.fullText;
        authors = parsed.authors.map((name) => ({ name }));
      } else {
        return extractWithUnpdf(file, arrayBuffer, projectId, existingPapers);
      }
    } else {
      return extractWithUnpdf(file, arrayBuffer, projectId, existingPapers);
    }

    // Supplement with PDF metadata if needed
    if (authors.length === 0 || !title) {
      try {
        const uint8 = new Uint8Array(arrayBuffer);
        const meta = await getMeta(uint8);
        if (authors.length === 0) {
          const pdfAuthor = meta.info?.Author as string | undefined;
          if (pdfAuthor) {
            authors = pdfAuthor.split(/[,;，；]/).map((n: string) => ({ name: n.trim() })).filter(a => a.name.length > 1);
          }
        }
        if (!title) title = (meta.info?.Title as string | undefined)?.trim();
      } catch { /* optional */ }
    }

    const finalTitle = title?.trim() || file.name.replace(/\.pdf$/i, "");

    // Try to match existing catalog paper
    const match = findMatch(finalTitle, existingPapers);

    if (match) {
      // Attach fullText to existing paper
      await prisma.paper.update({
        where: { id: match.id },
        data: { fullText: fullText.trim(), pdfFileName: file.name },
      });
      console.log(`[batch-upload] Matched: "${finalTitle}" → ${match.id}`);
      return { name: file.name, ok: true, matched: true };
    }

    // No match — create new entry
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
    console.log(`[batch-upload] Created: "${finalTitle}"`);
    return { name: file.name, ok: true, matched: false };
  } catch (err) {
    return { name: file.name, ok: false, matched: false, error: String(err) };
  }
}

async function extractWithUnpdf(
  file: File,
  arrayBuffer: ArrayBuffer,
  projectId: string,
  existingPapers: Array<{ id: string; title: string; fullText: string | null }>
): Promise<{ name: string; ok: boolean; matched: boolean; error?: string }> {
  try {
    const buffer = new Uint8Array(arrayBuffer);
    const { text: fullText } = await extractText(buffer, { mergePages: true });

    if (!fullText || fullText.trim().length < 100) {
      return { name: file.name, ok: false, matched: false, error: "could not extract text" };
    }

    let pdfTitle: string | undefined;
    let authors: { name: string }[] = [];
    try {
      const meta = await getMeta(buffer);
      pdfTitle = (meta.info?.Title as string | undefined)?.trim();
      const pdfAuthor = meta.info?.Author as string | undefined;
      if (pdfAuthor) {
        authors = pdfAuthor.split(/[,;，；]/).map((n: string) => ({ name: n.trim() })).filter(a => a.name.length > 1);
      }
    } catch { /* optional */ }

    const abstractMatch = fullText.match(
      /(?:abstract|摘\s*要)[:\s]*\n?([\s\S]{100,2000}?)(?:\n\s*(?:keywords|key\s*words|introduction|1[\s.]|关键词|引言))/i
    );

    const finalTitle = pdfTitle || file.name.replace(/\.pdf$/i, "");
    const match = findMatch(finalTitle, existingPapers);

    if (match) {
      await prisma.paper.update({
        where: { id: match.id },
        data: { fullText: fullText.trim(), pdfFileName: file.name },
      });
      return { name: file.name, ok: true, matched: true };
    }

    await prisma.paper.create({
      data: {
        projectId,
        title: finalTitle,
        abstract: abstractMatch?.[1]?.trim() ?? fullText.slice(0, 500),
        authors,
        source: "manual",
        citationCount: 0,
        referenceCount: 0,
        fullText: fullText.trim(),
        pdfFileName: file.name,
      },
    });

    return { name: file.name, ok: true, matched: false };
  } catch (err) {
    return { name: file.name, ok: false, matched: false, error: String(err) };
  }
}

export const maxDuration = 120;
