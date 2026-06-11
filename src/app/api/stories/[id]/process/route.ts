import { NextResponse } from "next/server";
import { requireContributorAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processStory } from "@/lib/story-processor";

// POST /api/stories/[id]/process — re-trigger processing
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const story = await prisma.story.findUnique({
    where: { id },
    select: { contributorId: true, status: true },
  });

  if (!story) {
    return NextResponse.json({ error: "故事不存在" }, { status: 404 });
  }

  if (story.contributorId !== auth.id) {
    return NextResponse.json({ error: "无权操作该故事" }, { status: 403 });
  }

  if (story.status === "PROCESSING") {
    return NextResponse.json(
      { error: "正在处理中，请稍候" },
      { status: 409 }
    );
  }

  // Reset to PENDING and re-trigger
  await prisma.story.update({
    where: { id },
    data: { status: "PENDING" },
  });

  processStory(id).catch((err) =>
    console.error(`[stories] processStory re-trigger failed for ${id}:`, err)
  );

  return NextResponse.json({ ok: true, status: "PENDING" });
}
