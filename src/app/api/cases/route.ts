import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/cases — list published cases for researchers
export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const contextType = searchParams.get("contextType");
  const q = searchParams.get("q");
  const projectId = searchParams.get("projectId");
  const mine = searchParams.get("mine"); // "1" to filter user's own stories
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = 20;

  // Build where clause
  const where: Record<string, unknown> = { status: "PUBLISHED" };
  if (category) where.obCategory = category;
  if (contextType) where.contextType = contextType;
  if (mine === "1") where.userId = auth.id;
  if (q) {
    where.OR = [
      { academicSummary: { contains: q, mode: "insensitive" } },
      { anonymizedContent: { contains: q, mode: "insensitive" } },
    ];
  }

  // Build select — conditionally include bookmarks only when projectId is present
  const select: Record<string, unknown> = {
    id: true,
    rawContent: true,
    anonymizedContent: true,
    academicSummary: true,
    keyPhenomena: true,
    theoryTags: true,
    obCategory: true,
    contextType: true,
    viewCount: true,
    bookmarkCount: true,
    createdAt: true,
    userId: true,
    status: true,
    followUpMessages: true,
  };

  if (projectId) {
    select.bookmarks = {
      where: { projectId, userId: auth.id },
      select: { id: true },
    };
  }

  const [cases, total] = await Promise.all([
    prisma.story.findMany({
      where,
      select,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.story.count({ where }),
  ]);

  // Increment view count for returned stories
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = cases.map((c: any) => c.id as string);
  if (ids.length > 0) {
    prisma.story
      .updateMany({
        where: { id: { in: ids } },
        data: { viewCount: { increment: 1 } },
      })
      .catch((err: unknown) =>
        console.error("[cases] viewCount increment failed:", err)
      );
  }

  // Map results to frontend-friendly shape
  const result = cases.map((c: Record<string, unknown>) => {
    const { bookmarks, keyPhenomena, obCategory, ...rest } = c as Record<string, unknown> & {
      bookmarks?: { id: string }[];
      keyPhenomena?: string[];
      obCategory?: string;
    };
    return {
      ...rest,
      obCategory: obCategory ?? null,
      category: obCategory ?? "",
      phenomena: Array.isArray(keyPhenomena) ? keyPhenomena : [],
      bookmarked: Array.isArray(bookmarks) ? bookmarks.length > 0 : false,
    };
  });

  return NextResponse.json({ cases: result, total, page, pageSize });
}
