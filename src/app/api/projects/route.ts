import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
