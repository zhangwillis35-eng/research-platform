/**
 * Admin endpoint: list pending registrations with invite codes.
 *
 * Protected by ADMIN_SECRET env var.
 * Usage: GET /api/admin/registrations?secret=<ADMIN_SECRET>
 *
 * Also supports:
 *   POST { secret, email } — approve: create user account from pending registration
 *   DELETE ?secret=&email= — reject: mark registration as rejected
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

function checkSecret(secret: string | null): boolean {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return false;
  return secret === adminSecret;
}

// GET /api/admin/registrations?secret=xxx
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  if (!checkSecret(searchParams.get("secret"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const pending = await prisma.pendingRegistration.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      inviteCode: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ pending });
}

// POST /api/admin/registrations — approve a registration (send email manually, code already in DB)
// This endpoint just returns the invite code so admin can copy it
export async function POST(request: Request) {
  const body = await request.json();
  const { secret, email } = body;

  if (!checkSecret(secret)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const reg = await prisma.pendingRegistration.findUnique({ where: { email } });
  if (!reg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    name: reg.name,
    email: reg.email,
    inviteCode: reg.inviteCode,
    status: reg.status,
  });
}

// DELETE /api/admin/registrations?secret=xxx&email=xxx — reject
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);

  if (!checkSecret(searchParams.get("secret"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const email = searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  await prisma.pendingRegistration.updateMany({
    where: { email },
    data: { status: "rejected" },
  });

  return NextResponse.json({ success: true });
}
