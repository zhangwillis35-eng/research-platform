import { NextResponse } from "next/server";
import { requireContributorAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/stories/[id] — get story detail (owner only)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const story = await prisma.story.findUnique({ where: { id } });

  if (!story) {
    return NextResponse.json({ error: "故事不存在" }, { status: 404 });
  }

  if (story.contributorId !== auth.id) {
    return NextResponse.json({ error: "无权访问该故事" }, { status: 403 });
  }

  return NextResponse.json({ story });
}

// DELETE /api/stories/[id] — delete own story
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const story = await prisma.story.findUnique({
    where: { id },
    select: { contributorId: true },
  });

  if (!story) {
    return NextResponse.json({ error: "故事不存在" }, { status: 404 });
  }

  if (story.contributorId !== auth.id) {
    return NextResponse.json({ error: "无权删除该故事" }, { status: 403 });
  }

  await prisma.story.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
