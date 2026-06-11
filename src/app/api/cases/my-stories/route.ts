import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/cases/my-stories — list current user's own stories (all statuses)
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const stories = await prisma.story.findMany({
    where: { userId: auth.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      rawContent: true,
      status: true,
      obCategory: true,
      contextType: true,
      academicSummary: true,
      keyPhenomena: true,
      theoryTags: true,
      anonymizedContent: true,
      followUpMessages: true,
      viewCount: true,
      bookmarkCount: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ stories });
}
