import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { callAI, setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai/types";

// Check if abstract looks truncated (snippet from Google Scholar, etc.)
function isAbstractIncomplete(abstract: string | null | undefined): boolean {
  if (!abstract) return true;
  if (abstract.length < 200) return true;
  if (abstract.includes("...") || abstract.includes("\u2026")) return true;
  return false;
}

// Fetch full abstract from OpenAlex by title or DOI
async function fetchFullAbstract(
  title: string,
  doi?: string | null
): Promise<string | null> {
  try {
    let url: string;
    if (doi) {
      url = `https://api.openalex.org/works/doi:${doi}?select=abstract_inverted_index`;
    } else {
      const params = new URLSearchParams({
        search: title,
        per_page: "1",
        select: "abstract_inverted_index,display_name",
      });
      url = `https://api.openalex.org/works?${params}`;
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const data = await res.json();
    const work = doi ? data : data.results?.[0];
    if (!work) return null;

    const invIdx = work.abstract_inverted_index;
    if (!invIdx) return null;

    const words: string[] = [];
    for (const [word, positions] of Object.entries(invIdx)) {
      for (const pos of positions as number[]) words[pos] = word;
    }
    const full = words.join(" ").trim();
    return full.length > 50 ? full : null;
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  setAIContext(auth.id, "/api/papers/analyze");

  const { provider = "gemini" } = await request.json().catch(() => ({}));

  const paper = await prisma.paper.findUnique({ where: { id } });
  if (!paper) {
    return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  }

  // If abstract is incomplete, try to fetch full version from OpenAlex
  let abstract = paper.abstract;
  if (isAbstractIncomplete(abstract)) {
    const fullAbstract = await fetchFullAbstract(paper.title, paper.doi);
    if (fullAbstract) {
      abstract = fullAbstract;
      // Save the full abstract back to database
      await prisma.paper.update({
        where: { id },
        data: { abstract: fullAbstract },
      });
    }
  }

  // Return cached analysis if exists (and abstract hasn't changed)
  if (paper.aiAnalysis) {
    return NextResponse.json({ analysis: paper.aiAnalysis, abstract });
  }

  if (!abstract) {
    return NextResponse.json({ analysis: "该文献无摘要，无法生成分析。", abstract });
  }

  const authors = (paper.authors as Array<{ name: string }>)
    ?.slice(0, 5)
    .map((a) => a.name)
    .join(", ") ?? "Unknown";

  const system = `You are a management research methodology expert. Perform a concise, structured analysis of the following academic paper.

The analysis must include these four sections, 1-3 sentences each, be concise:

**Theoretical Model**: What theoretical framework or conceptual model? Core logic?

**Key Variables**: Independent, dependent, mediating, moderating variables? (If identifiable from abstract)

**Research Method**: What method (empirical, case study, experiment, survey, ML, etc.)? Data source and sample?

**Marginal Contribution**: Innovation and marginal contribution relative to existing literature?

Format requirements:
- Respond in Chinese
- Bold section headers
- If abstract lacks info for a section, note "摘要未提及"
- 200-400 Chinese characters total`;

  try {
    const result = await callAI({
      provider: provider as AIProvider,
      messages: [
        {
          role: "user",
          content: `Title: ${paper.title}\nAuthors: ${authors}\nYear: ${paper.year ?? "N/A"}\nVenue: ${paper.venue ?? "N/A"}\nCitations: ${paper.citationCount}\n\nAbstract:\n${abstract}`,
        },
      ],
      system,
      temperature: 0.2,
      maxTokens: 1500,
    });

    const analysis = result.content;

    // Cache to database
    await prisma.paper.update({
      where: { id },
      data: { aiAnalysis: analysis },
    });

    return NextResponse.json({ analysis, abstract });
  } catch (error) {
    return NextResponse.json(
      { error: "Analysis failed", details: String(error) },
      { status: 500 }
    );
  }
}
