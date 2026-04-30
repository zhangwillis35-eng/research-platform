import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { findSimilarPapers, isSpecterAvailable } from "@/lib/sources/specter";

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    if (!isSpecterAvailable()) {
      return NextResponse.json(
        { error: "SPECTER2 not configured. Set HF_TOKEN in environment." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { queryTitle, queryAbstract, papers, topK = 10 } = body as {
      queryTitle: string;
      queryAbstract?: string;
      papers: Array<{ title: string; abstract?: string; doi?: string }>;
      topK?: number;
    };

    if (!queryTitle || !papers?.length) {
      return NextResponse.json({ error: "queryTitle and papers required" }, { status: 400 });
    }

    const results = await findSimilarPapers(queryTitle, queryAbstract, papers, topK);
    return NextResponse.json({ results, model: "specter2" });
  } catch (error) {
    console.error("Similar papers error:", error);
    return NextResponse.json(
      { error: "Failed to find similar papers", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
