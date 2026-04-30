import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET — load chat messages for a project + query
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const query = searchParams.get("query");

  if (!projectId || !query) {
    return NextResponse.json({ error: "projectId and query required" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  const record = await prisma.chatHistory.findUnique({
    where: { projectId_query: { projectId, query } },
  });

  return NextResponse.json({ messages: record?.messages ?? [] });
}

// POST — save/update chat messages for a project + query
export async function POST(request: Request) {
  try {
    const { projectId, query, messages, provider } = await request.json();

    if (!projectId || !query) {
      return NextResponse.json({ error: "projectId and query required" }, { status: 400 });
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;

    const record = await prisma.chatHistory.upsert({
      where: { projectId_query: { projectId, query } },
      create: { projectId, query, messages: messages ?? [], provider: provider ?? null },
      update: { messages: messages ?? [], provider: provider ?? null },
    });

    return NextResponse.json({ id: record.id });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save chat history", details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE — clear chat history
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const query = searchParams.get("query");

  if (!projectId || !query) {
    return NextResponse.json({ error: "projectId and query required" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  // Delete chat history and associated search history together
  await Promise.all([
    prisma.chatHistory.deleteMany({ where: { projectId, query } }),
    prisma.searchHistory.deleteMany({ where: { projectId, query } }),
  ]);

  return NextResponse.json({ success: true });
}
