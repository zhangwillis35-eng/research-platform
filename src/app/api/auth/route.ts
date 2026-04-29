import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

// POST /api/auth — register, login, logout, me
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };

    // ─── Register: phone verified → create account with email + password ──
    if (action === "register") {
      const { phone, code, name, email, password } = body as {
        phone: string;
        code: string;
        name: string;
        email: string;
        password: string;
      };

      if (!phone || !code || !name?.trim() || !email?.trim() || !password) {
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

      // Verify SMS code
      const record = await prisma.verificationCode.findFirst({
        where: {
          phone,
          code,
          used: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!record) {
        return NextResponse.json(
          { error: "验证码错误或已过期" },
          { status: 400 }
        );
      }

      // Check email uniqueness
      const existingEmail = await prisma.user.findUnique({
        where: { email },
      });
      if (existingEmail) {
        return NextResponse.json(
          { error: "该邮箱已被注册" },
          { status: 400 }
        );
      }

      // Check phone uniqueness
      const existingPhone = await prisma.user.findUnique({
        where: { phone },
      });
      if (existingPhone) {
        return NextResponse.json(
          { error: "该手机号已注册，请直接登录" },
          { status: 400 }
        );
      }

      // Mark code as used
      await prisma.verificationCode.update({
        where: { id: record.id },
        data: { used: true },
      });

      // Create user
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          phone,
          email,
          name,
          password: hashedPassword,
        },
      });

      // Set session
      const cookieStore = await cookies();
      cookieStore.set("user_id", user.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
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
        secure: process.env.NODE_ENV === "production",
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
        user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "服务器错误", details: String(error) },
      { status: 500 }
    );
  }
}
