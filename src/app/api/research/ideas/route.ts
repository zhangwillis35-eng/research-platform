import { NextResponse } from "next/server";
import { runIdeaPipeline } from "@/lib/research/idea-pipeline";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      papers,
      provider = "gemini",
      withPeerReview = true,
    } = body as {
      papers: UnifiedPaper[];
      provider?: AIProvider;
      withPeerReview?: boolean;
    };

    if (!papers?.length) {
      return NextResponse.json(
        { error: "Papers are required" },
        { status: 400 }
      );
    }

    const result = await runIdeaPipeline(papers, provider, withPeerReview);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Idea pipeline error:", error);
    return NextResponse.json(
      { error: "Idea generation failed", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 120;
