import { NextResponse } from "next/server";
import { requireAuth, requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET — list search history (lightweight, no papers)
// GET with ?id=xxx — get full record including papers
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const id = searchParams.get("id");

  // Get single full record
  if (id) {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const record = await prisma.searchHistory.findUnique({ where: { id } });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ record });
  }

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  // List — exclude heavy papers field for speed
  const history = await prisma.searchHistory.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      query: true,
      translatedQuery: true,
      keyTerms: true,
      filters: true,
      paperCount: true,
      provider: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ history });
}

// POST — save a complete search record
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      projectId, query, translatedQuery, keyTerms, synonyms,
      precisionQueries, broadQueries, filters, papers, stats,
      paperCount, provider,
    } = body;

    if (!projectId || !query) {
      return NextResponse.json({ error: "projectId and query required" }, { status: 400 });
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;

    const record = await prisma.searchHistory.create({
      data: {
        projectId,
        query,
        translatedQuery: translatedQuery ?? null,
        keyTerms: keyTerms ?? null,
        synonyms: synonyms ?? null,
        precisionQueries: precisionQueries ?? null,
        broadQueries: broadQueries ?? null,
        filters: filters ?? null,
        papers: papers ?? null,
        stats: stats ?? null,
        paperCount: paperCount ?? 0,
        provider: provider ?? null,
      },
      select: {
        id: true,
        query: true,
        translatedQuery: true,
        keyTerms: true,
        filters: true,
        paperCount: true,
        provider: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ record });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save search history", details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  await prisma.searchHistory.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
