import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;

  const cookieStore = await cookies();

  // ─── Register ──────────────────────────────────────────────────────
  if (action === "register") {
    const { email, password, nickname } = body;

    if (!email || !password || !nickname) {
      return NextResponse.json(
        { error: "请填写邮箱、密码和昵称" },
        { status: 400 }
      );
    }

    const existing = await prisma.contributor.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "该邮箱已注册" },
        { status: 409 }
      );
    }

    const hashed = await bcrypt.hash(password, 10);
    const contributor = await prisma.contributor.create({
      data: { email, password: hashed, nickname },
      select: { id: true, email: true, nickname: true },
    });

    cookieStore.set("contributor_id", contributor.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return NextResponse.json({ ok: true, contributor });
  }

  // ─── Login ─────────────────────────────────────────────────────────
  if (action === "login") {
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "请填写邮箱和密码" },
        { status: 400 }
      );
    }

    const contributor = await prisma.contributor.findUnique({
      where: { email },
    });
    if (!contributor) {
      return NextResponse.json(
        { error: "邮箱或密码错误" },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, contributor.password);
    if (!valid) {
      return NextResponse.json(
        { error: "邮箱或密码错误" },
        { status: 401 }
      );
    }

    cookieStore.set("contributor_id", contributor.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return NextResponse.json({
      ok: true,
      contributor: {
        id: contributor.id,
        email: contributor.email,
        nickname: contributor.nickname,
      },
    });
  }

  // ─── Logout ────────────────────────────────────────────────────────
  if (action === "logout") {
    cookieStore.delete("contributor_id");
    return NextResponse.json({ ok: true });
  }

  // ─── Me ────────────────────────────────────────────────────────────
  if (action === "me") {
    const contributorId = cookieStore.get("contributor_id")?.value;
    if (!contributorId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const contributor = await prisma.contributor.findUnique({
      where: { id: contributorId },
      select: { id: true, email: true, nickname: true, createdAt: true },
    });

    if (!contributor) {
      cookieStore.delete("contributor_id");
      return NextResponse.json({ error: "账号不存在" }, { status: 401 });
    }

    return NextResponse.json({ ok: true, contributor });
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
