import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { formatCitation, type CitationStyle } from "@/lib/citation";

const ALL_STYLES: CitationStyle[] = ["apa", "mla", "chicago", "gb-t-7714", "bibtex"];

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { paper, style = "apa", allStyles, papers } = body as {
      paper?: { title: string; authors: { name: string }[]; year?: number; venue?: string; doi?: string };
      style?: CitationStyle;
      allStyles?: boolean;
      papers?: Array<{ title: string; authors: { name: string }[]; year?: number; venue?: string; doi?: string }>;
    };

    // All styles for one paper
    if (paper && allStyles) {
      const results: Record<string, string> = {};
      await Promise.all(
        ALL_STYLES.map(async (s) => {
          results[s] = await formatCitation(paper, s);
        })
      );
      return NextResponse.json({ citations: results });
    }

    // Single paper, single style
    if (paper) {
      const citation = await formatCitation(paper, style);
      return NextResponse.json({ citation, style });
    }

    // Batch
    if (papers?.length) {
      const citations = await Promise.all(
        papers.map((p) => formatCitation(p, style))
      );
      return NextResponse.json({ citations, style });
    }

    return NextResponse.json({ error: "paper or papers required" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "Citation formatting failed", details: String(error) },
      { status: 500 }
    );
  }
}
