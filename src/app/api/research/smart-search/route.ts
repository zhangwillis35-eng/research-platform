import { NextResponse } from "next/server";
import { smartSearch } from "@/lib/research/smart-search";
import type { AIProvider } from "@/lib/ai";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, provider = "gemini", limit = 20 } = body as {
      query: string;
      provider?: AIProvider;
      limit?: number;
    };

    if (!query?.trim()) {
      return NextResponse.json({ error: "Query required" }, { status: 400 });
    }

    const result = await smartSearch(query, provider, limit);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Smart search error:", error);
    return NextResponse.json(
      { error: "Smart search failed", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
