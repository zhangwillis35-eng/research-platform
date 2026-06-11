import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processStory } from "@/lib/story-processor";

// POST /api/cases/submit — researcher submits a story from case library
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { content } = await request.json();

  if (!content || content.trim().length < 5) {
    return NextResponse.json(
      { error: "故事内容至少需要5个字符" },
      { status: 400 },
    );
  }

  const story = await prisma.story.create({
    data: {
      userId: auth.id,
      rawContent: content,
    },
  });

  // Fire processing in background
  processStory(story.id).catch((err) =>
    console.error(`[cases/submit] processStory failed for ${story.id}:`, err),
  );

  return NextResponse.json({ id: story.id, status: "PENDING" });
}
