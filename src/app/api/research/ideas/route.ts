import { NextResponse } from "next/server";
import { runIdeaPipeline } from "@/lib/research/idea-pipeline";
import { setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";
import { requireAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    setAIContext(auth.id, "/api/research/ideas");

    const body = await request.json();
    const {
      papers,
      provider = "deepseek-fast",
      withPeerReview = true,
      topic,
      notebookLM,
    } = body as {
      papers: UnifiedPaper[];
      provider?: AIProvider;
      withPeerReview?: boolean;
      topic?: string;
      notebookLM?: import("@/lib/integrations/notebooklm").NotebookLMConfig | null;
    };

    if (!papers?.length) {
      return NextResponse.json(
        { error: "Papers are required" },
        { status: 400 }
      );
    }

    const result = await runIdeaPipeline(papers, provider, withPeerReview, notebookLM, topic);

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
