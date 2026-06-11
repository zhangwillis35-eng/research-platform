import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";

// POST /api/cases/bookmark — toggle bookmark on a case
export async function POST(request: Request) {
  const { storyId, projectId, note } = await request.json();

  if (!storyId || !projectId) {
    return NextResponse.json(
      { error: "storyId and projectId are required" },
      { status: 400 }
    );
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  const existing = await prisma.caseBookmark.findUnique({
    where: {
      storyId_projectId_userId: {
        storyId,
        projectId,
        userId: auth.id,
      },
    },
  });

  if (existing) {
    // Remove bookmark
    await prisma.$transaction([
      prisma.caseBookmark.delete({ where: { id: existing.id } }),
      prisma.story.update({
        where: { id: storyId },
        data: { bookmarkCount: { decrement: 1 } },
      }),
    ]);
    return NextResponse.json({ bookmarked: false });
  }

  // Create bookmark
  await prisma.$transaction([
    prisma.caseBookmark.create({
      data: { storyId, projectId, userId: auth.id, note },
    }),
    prisma.story.update({
      where: { id: storyId },
      data: { bookmarkCount: { increment: 1 } },
    }),
  ]);

  return NextResponse.json({ bookmarked: true });
}
