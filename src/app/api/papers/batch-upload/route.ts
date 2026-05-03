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

const FULLTEXT_MAX = 30_000;

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
    const uint8 = new Uint8Array(arrayBuffer);

    // Extract text with unpdf (~150ms, no ML, no Java)
    let rawText: string;
    try {
      const { text } = await extractText(uint8, { mergePages: true });
      rawText = text ?? "";
    } catch {
      return NextResponse.json({ error: "could not extract text" }, { status: 422 });
    }

    if (rawText.trim().length < 100) {
      return NextResponse.json({ error: "could not extract text (scanned PDF?)" }, { status: 422 });
    }

    const fullText = rawText.trim().slice(0, FULLTEXT_MAX);

    // Extract metadata with regex (instant, no network)
    const { title, abstract, authors } = extractMetadata(rawText, file.name);

    // Single DB query: check for existing title match
    const existing = await prisma.paper.findMany({
      where: { projectId },
      select: { id: true, title: true },
    });

    const match = findTitleMatch(title, existing);

    if (match) {
      await prisma.paper.update({
        where: { id: match.id },
        data: { fullText, pdfFileName: file.name, ...(abstract ? { abstract } : {}) },
      });
      return NextResponse.json({ ok: true, matched: true, title });
    }

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

  // Title: first line that is 20-200 chars and not all-caps junk / numbers
  let title = fileName.replace(/\.pdf$/i, "");
  for (const line of lines.slice(0, 20)) {
    if (line.length >= 15 && line.length <= 250 && !/^[\d\s.]+$/.test(line) && !line.startsWith("http")) {
      title = line;
      break;
    }
  }

  // Abstract: text between "Abstract" and "Keywords/Introduction/1."
  const abstractMatch = text.match(
    /(?:abstract|摘\s*要)[:\s\n]+([\s\S]{80,2500}?)(?:\n\s*(?:keywords?|key\s*words?|introduction|1[\s.。]|关键词|引言|\n\n\n))/i
  );
  const abstract = abstractMatch?.[1]?.replace(/\s+/g, " ").trim();

  // Authors: lines between title and abstract that look like author names
  const authors: { name: string }[] = [];
  const authorSection = text.slice(0, 2000);
  const authorPattern = /^[A-Z][a-z]+([\s-][A-Z][a-z]+){1,4}(,\s*[A-Z][a-z]+([\s-][A-Z][a-z]+){1,4})*$/m;
  const authorMatch = authorSection.match(authorPattern);
  if (authorMatch) {
    authorMatch[0].split(",").forEach((name) => {
      const n = name.trim();
      if (n.length > 3 && n.split(" ").length >= 2) authors.push({ name: n });
    });
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
