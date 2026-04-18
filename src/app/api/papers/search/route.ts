import { NextResponse } from "next/server";
import { searchAllSources } from "@/lib/sources/aggregator";
import type { SearchOptions, UnifiedPaper } from "@/lib/sources/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const options: SearchOptions = {
      query: body.query,
      limit: body.limit ?? 20,
      yearFrom: body.yearFrom,
      yearTo: body.yearTo,
      sources: body.sources,
    };

    if (!options.query?.trim()) {
      return NextResponse.json(
        { error: "Search query is required" },
        { status: 400 }
      );
    }

    const { papers, results } = await searchAllSources(options);

    // Sort by citation count descending
    papers.sort((a: UnifiedPaper, b: UnifiedPaper) => b.citationCount - a.citationCount);

    return NextResponse.json({
      papers,
      meta: {
        total: papers.length,
        sources: results.map((r) => ({
          source: r.source,
          count: r.papers.length,
          total: r.total,
        })),
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed", details: String(error) },
      { status: 500 }
    );
  }
}
