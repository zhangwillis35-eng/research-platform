import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { extractText } from "unpdf";

/**
 * POST /api/papers/batch-upload — single-file, no GROBID, no OSS.
 *
 * Pipeline per file:
 *   unpdf (~150ms) → regex metadata → 1 DB upsert (~100ms) = ~300ms/file
 *
 * Frontend sends one file at a time with 5 concurrent fetches.
 * Smart title matching: attach fullText to existing catalog paper if found.
 *
 * Body: multipart with `file` (single PDF) + `projectId`
 */

// No character limit — store full text for complete analysis

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const projectId = formData.get("projectId") as string | null;
    const file = formData.get("file") as File | null;

    if (!projectId || !file) {
      return NextResponse.json({ error: "projectId and file required" }, { status: 400 });
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "not a PDF" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(new Uint8Array(arrayBuffer));

    // Extract text with unpdf (~150ms, no ML, no Java)
    let rawText: string;
    try {
      const { text } = await extractText(uint8, { mergePages: true });
      rawText = text ?? "";
    } catch {
      return NextResponse.json({ error: "could not extract text" }, { status: 422 });
    }

    // Strip null bytes — PostgreSQL TEXT rejects \x00
    rawText = rawText.replace(/\x00/g, "");

    if (rawText.trim().length < 50) {
      return NextResponse.json({ error: "文本过少，可能是扫描版 PDF" }, { status: 422 });
    }

    const fullText = rawText.trim();

    // Extract metadata with regex (instant, no network)
    const { title, abstract, authors } = extractMetadata(rawText, file.name);

    // Always create new paper (no fuzzy matching — avoids false positives)
    await prisma.paper.create({
      data: {
        projectId,
        title,
        abstract: abstract ?? fullText.slice(0, 500),
        authors,
        source: "manual",
        citationCount: 0,
        referenceCount: 0,
        fullText,
        pdfFileName: file.name,
      },
    });

    return NextResponse.json({ ok: true, matched: false, title });
  } catch (error) {
    console.error("[batch-upload] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** Extract title, abstract, authors from raw PDF text using heuristics */
function extractMetadata(text: string, fileName: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const hasLineBreaks = lines.length > 5;

  let title = fileName.replace(/\.pdf$/i, "");
  let abstract: string | undefined;
  const authors: { name: string }[] = [];

  if (hasLineBreaks) {
    // Normal PDF: look for first meaningful line as title
    for (const line of lines.slice(0, 20)) {
      if (line.length >= 15 && line.length <= 250 && !/^[\d\s.]+$/.test(line) && !line.startsWith("http")) {
        title = line;
        break;
      }
    }
  } else {
    // Single-line PDF (no line breaks): extract title before "Abstract"
    const beforeAbstract = text.match(/^(.*?)(?:\s*Abstract[\s—:.-])/i);
    if (beforeAbstract) {
      // Strip arXiv IDs, dates, author names from the front
      let candidate = beforeAbstract[1]
        .replace(/arXiv:\S+\s*/g, "")
        .replace(/\[\w+\.\w+\]\s*/g, "")
        .replace(/\d{1,2}\s+\w+\s+\d{4}\s*/g, "")
        .trim();
      // Cut before author names: "FirstName LastName*" or "FirstName LastName,"
      const authorStart = candidate.search(/\s[A-Z][a-z]+\s+[A-Z][a-z]+\s*[\*†‡\d]/);
      if (authorStart > 10) candidate = candidate.slice(0, authorStart).trim();
      if (candidate.length >= 10 && candidate.length <= 300) title = candidate;
    }
  }

  // Abstract: text between "Abstract" and next section heading
  const abstractMatch = text.match(
    /(?:abstract|摘\s*要)[\s—:.-]*([\s\S]{80,3000}?)(?:\b(?:keywords?|key\s*words?|introduction|1[\s.。]|关键词|引言)\b|\n\n\n)/i
  );
  abstract = abstractMatch?.[1]?.replace(/\s+/g, " ").trim();

  // Authors: look for "Name, Name" patterns in first 2000 chars
  const authorSection = text.slice(0, 2000);
  const authorPattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})(?:\s*[\*†‡\d,]+\s*)/g;
  let authorMatch;
  while ((authorMatch = authorPattern.exec(authorSection)) !== null) {
    const name = authorMatch[1].trim();
    if (name.split(" ").length >= 2 && name.length <= 40 && !name.match(/^(Abstract|Introduction|University|Department)/)) {
      authors.push({ name });
    }
    if (authors.length >= 10) break;
  }

  return { title, abstract, authors };
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function findTitleMatch(
  title: string,
  papers: Array<{ id: string; title: string }>
): { id: string } | null {
  const norm = normalizeTitle(title);
  if (norm.length < 10) return null;
  for (const p of papers) {
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

export const maxDuration = 30;
