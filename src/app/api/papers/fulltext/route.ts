import { NextResponse } from "next/server";
import { fetchFullText } from "@/lib/research/fulltext-fetcher";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { doi, openAccessPdf, unpaywallUrl, title, usePlaywright } = body as {
      doi?: string;
      openAccessPdf?: string;
      unpaywallUrl?: string;
      title: string;
      usePlaywright?: boolean;
    };

    if (!title) {
      return NextResponse.json({ error: "Title required" }, { status: 400 });
    }

    const result = await fetchFullText(
      { doi, openAccessPdf, unpaywallUrl, title },
      { usePlaywright }
    );

    if (!result) {
      return NextResponse.json(
        { error: "Full text not available", available: false },
        { status: 404 }
      );
    }

    return NextResponse.json({ available: true, ...result });
  } catch (error) {
    console.error("Full text fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch full text", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 60; // longer for Playwright
