import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const VALID_SECTIONS = [
  "review", "graph", "analysis", "ideas", "theories", "model", "proposal",
] as const;
type NoteSection = (typeof VALID_SECTIONS)[number];

function noteKey(section: NoteSection): string {
  return `__note:${section}`;
}

// GET /api/projects/[id]/note?section=review
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const { searchParams } = new URL(request.url);
  const section = searchParams.get("section") as NoteSection | null;

  if (!section || !VALID_SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Invalid section" }, { status: 400 });
  }

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const record = await prisma.chatHistory.findUnique({
    where: { projectId_query: { projectId, query: noteKey(section) } },
    select: { messages: true, updatedAt: true },
  });

  if (!record) return NextResponse.json({ content: "", updatedAt: null });

  const data = record.messages as { content?: string };
  return NextResponse.json({
    content: data?.content ?? "",
    updatedAt: record.updatedAt.toISOString(),
  });
}

// POST /api/projects/[id]/note
// Body: { section, content }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const { section, content } = await request.json();

    if (!section || !VALID_SECTIONS.includes(section)) {
      return NextResponse.json({ error: "Invalid section" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const query = noteKey(section as NoteSection);

    const record = await prisma.chatHistory.upsert({
      where: { projectId_query: { projectId, query } },
      create: { projectId, query, messages: { content: content ?? "" }, provider: "note" },
      update: { messages: { content: content ?? "" } },
    });

    return NextResponse.json({ updatedAt: record.updatedAt.toISOString() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
