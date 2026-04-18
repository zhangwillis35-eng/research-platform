import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// DELETE /api/papers/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.paper.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

// PUT /api/papers/[id] — toggle selected, update notes
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const paper = await prisma.paper.update({
    where: { id },
    data: {
      isSelected: body.isSelected,
      notes: body.notes,
    },
  });

  return NextResponse.json({ paper });
}
