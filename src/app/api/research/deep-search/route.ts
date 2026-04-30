import { NextResponse } from "next/server";
import { deepSearch } from "@/lib/research/deep-search";
import type { AIProvider } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { topic, provider = "gemini" } = body as {
      topic: string;
      provider?: AIProvider;
    };

    if (!topic?.trim()) {
      return NextResponse.json(
        { error: "Research topic is required" },
        { status: 400 }
      );
    }

    const result = await deepSearch(topic, provider);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Deep search error:", error);
    return NextResponse.json(
      { error: "Deep search failed", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 60; // Allow up to 60s for deep search
