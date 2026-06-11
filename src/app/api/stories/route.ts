import { NextResponse } from "next/server";
import { requireContributorAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processStory } from "@/lib/story-processor";

// GET /api/stories — list contributor's own stories
export async function GET() {
  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const stories = await prisma.story.findMany({
    where: { contributorId: auth.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      obCategory: true,
      contextType: true,
      academicSummary: true,
      keyPhenomena: true,
      theoryTags: true,
      viewCount: true,
      bookmarkCount: true,
      createdAt: true,
      rawContent: true,
    },
  });

  // Truncate rawContent to 100 chars preview
  const result = stories.map((s) => ({
    ...s,
    rawContent: s.rawContent.length > 100
      ? s.rawContent.slice(0, 100) + "…"
      : s.rawContent,
  }));

  return NextResponse.json({ stories: result });
}

// POST /api/stories — submit new story
export async function POST(request: Request) {
  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const { content } = await request.json();

  if (!content || content.trim().length < 50) {
    return NextResponse.json(
      { error: "故事内容至少需要50个字符" },
      { status: 400 }
    );
  }

  const story = await prisma.story.create({
    data: {
      contributorId: auth.id,
      rawContent: content,
    },
  });

  // Fire processing in background — don't await
  processStory(story.id).catch((err) =>
    console.error(`[stories] processStory failed for ${story.id}:`, err)
  );

  return NextResponse.json({ id: story.id, status: "PENDING" });
}
