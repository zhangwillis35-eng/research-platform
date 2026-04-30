import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

// POST /api/auth — register, login, logout, me
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };

    // ─── Register: direct account creation ──────────
    if (action === "register") {
      const { name, email, password } = body as {
        name: string;
        email: string;
        password: string;
      };

      if (!name?.trim() || !email?.trim() || !password) {
        return NextResponse.json(
          { error: "所有字段均为必填" },
          { status: 400 }
        );
      }

      if (password.length < 6) {
        return NextResponse.json(
          { error: "密码至少 6 位" },
          { status: 400 }
        );
      }

      // Check if email already registered
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return NextResponse.json(
          { error: "该邮箱已注册，请直接登录" },
          { status: 400 }
        );
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: { name, email, password: hashedPassword },
      });

      // Auto-login
      const cookieStore = await cookies();
      cookieStore.set("user_id", user.id, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });

      return NextResponse.json({
        user: { id: user.id, name: user.name, email: user.email },
      });
    }

    // ─── Login: email + password ─────────────────────
    if (action === "login") {
      const { email, password } = body as {
        email: string;
        password: string;
      };

      if (!email?.trim() || !password) {
        return NextResponse.json(
          { error: "请输入邮箱和密码" },
          { status: 400 }
        );
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.password) {
        return NextResponse.json(
          { error: "邮箱或密码错误" },
          { status: 400 }
        );
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return NextResponse.json(
          { error: "邮箱或密码错误" },
          { status: 400 }
        );
      }

      const cookieStore = await cookies();
      cookieStore.set("user_id", user.id, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });

      return NextResponse.json({
        user: { id: user.id, name: user.name, email: user.email },
      });
    }

    // ─── Logout ──────────────────────────────────────
    if (action === "logout") {
      const cookieStore = await cookies();
      cookieStore.delete("user_id");
      return NextResponse.json({ success: true });
    }

    // ─── Get current user ────────────────────────────
    if (action === "me") {
      const cookieStore = await cookies();
      const userId = cookieStore.get("user_id")?.value;
      if (!userId) {
        return NextResponse.json({ user: null });
      }
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return NextResponse.json({ user: null });
      }
      return NextResponse.json({
        user: { id: user.id, name: user.name, email: user.email },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[auth]", error);
    return NextResponse.json(
      { error: "服务器错误" },
      { status: 500 }
    );
  }
}
