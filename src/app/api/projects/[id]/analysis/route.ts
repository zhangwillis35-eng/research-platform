import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";

const VALID_TYPES = ["graph", "ideas", "theories", "model", "review", "chat"] as const;
type AnalysisType = (typeof VALID_TYPES)[number];

function analysisKey(type: AnalysisType): string {
  return `__analysis:${type}`;
}

// GET /api/projects/[id]/analysis?type=graph|ideas|theories|model|review|chat
// Returns: { data, updatedAt } or { data: null }
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as AnalysisType | null;

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type is required and must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  const record = await prisma.chatHistory.findUnique({
    where: { projectId_query: { projectId, query: analysisKey(type) } },
  });

  if (!record) {
    return NextResponse.json({ data: null });
  }

  return NextResponse.json({
    data: record.messages,
    updatedAt: record.updatedAt.toISOString(),
  });
}

// POST /api/projects/[id]/analysis
// Body: { type: string, data: any }
// Upserts analysis results for this project + type
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const { type, data } = await request.json();

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `type is required and must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;

    const query = analysisKey(type as AnalysisType);

    const record = await prisma.chatHistory.upsert({
      where: { projectId_query: { projectId, query } },
      create: {
        projectId,
        query,
        messages: data ?? {},
        provider: "analysis",
      },
      update: {
        messages: data ?? {},
      },
    });

    return NextResponse.json({
      id: record.id,
      updatedAt: record.updatedAt.toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save analysis", details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[id]/analysis?type=graph|ideas|theories|model|review|chat
// Deletes saved analysis for this project + type
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as AnalysisType | null;

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type is required and must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  await prisma.chatHistory.deleteMany({
    where: { projectId, query: analysisKey(type) },
  });

  return NextResponse.json({ success: true });
}
