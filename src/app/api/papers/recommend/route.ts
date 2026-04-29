import { NextResponse } from "next/server";
import {
  getRecommendations,
  getCitingPapers,
  getReferencedPapers,
  getPaperByDOI,
} from "@/lib/sources/semantic-scholar";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { doi, paperId, type = "similar", limit = 10 } = body as {
      doi?: string;
      paperId?: string;
      type?: "similar" | "citing" | "references";
      limit?: number;
    };

    // Resolve paper ID from DOI if needed
    let s2Id = paperId;
    if (!s2Id && doi) {
      const paper = await getPaperByDOI(doi);
      s2Id = paper?.externalId;
    }

    if (!s2Id) {
      return NextResponse.json(
        { error: "Could not resolve paper ID. Provide doi or paperId." },
        { status: 400 }
      );
    }

    let papers;
    switch (type) {
      case "similar":
        papers = await getRecommendations([s2Id], limit);
        break;
      case "citing":
        papers = await getCitingPapers(s2Id, limit);
        break;
      case "references":
        papers = await getReferencedPapers(s2Id, limit);
        break;
      default:
        papers = await getRecommendations([s2Id], limit);
    }

    return NextResponse.json({ papers, type, count: papers.length });
  } catch (error) {
    return NextResponse.json(
      { error: "Recommendation failed", details: String(error) },
      { status: 500 }
    );
  }
}
