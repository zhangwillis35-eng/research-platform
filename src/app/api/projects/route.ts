import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deletePdf } from "@/lib/oss";
import { getSessionUser } from "@/lib/auth";

// GET /api/projects — returns projects owned by the logged-in user
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await prisma.researchProject.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { papers: true, ideas: true } },
    },
  });

  return NextResponse.json({ projects });
}

// DELETE /api/projects?id=xxx — only the owner can delete
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Verify ownership before deleting
  const project = await prisma.researchProject.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (project.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Find all papers with OSS keys to clean up cloud storage
    const papers = await prisma.paper.findMany({
      where: { projectId: id, pdfOssKey: { not: null } },
      select: { pdfOssKey: true },
    });

    // Delete OSS files in parallel
    await Promise.allSettled(papers.map((p) => deletePdf(p.pdfOssKey!)));

    // Delete project — cascades to all related records
    await prisma.researchProject.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete project", details: String(error) },
      { status: 500 }
    );
  }
}

// POST /api/projects — creates a project for the logged-in user
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, description, domain } = body;

    if (!name) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const project = await prisma.researchProject.create({
      data: { name, description, domain, userId: user.id },
    });

    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create project", details: String(error) },
      { status: 500 }
    );
  }
}
