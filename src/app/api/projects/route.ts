import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deletePdf } from "@/lib/oss";

// GET /api/projects?userId=xxx
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") ?? "default-user";

  const projects = await prisma.researchProject.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { papers: true, ideas: true } },
    },
  });

  return NextResponse.json({ projects });
}

// DELETE /api/projects?id=xxx
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    // Find all papers with OSS keys to clean up cloud storage
    const papers = await prisma.paper.findMany({
      where: { projectId: id, pdfOssKey: { not: null } },
      select: { pdfOssKey: true },
    });

    // Delete OSS files in parallel
    await Promise.allSettled(
      papers.map((p) => deletePdf(p.pdfOssKey!))
    );

    // Delete project — cascades to all related records (papers, reviews, ideas, etc.)
    await prisma.researchProject.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete project", details: String(error) },
      { status: 500 }
    );
  }
}

// POST /api/projects
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, domain, userId = "default-user" } = body;

    if (!name) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    // Ensure user exists
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, email: `${userId}@scholarflow.app` },
    });

    const project = await prisma.researchProject.create({
      data: { name, description, domain, userId },
    });

    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create project", details: String(error) },
      { status: 500 }
    );
  }
}
