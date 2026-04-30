import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

/** Generate a random 8-char invite code (uppercase letters + digits) */
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// POST /api/auth — register, verify-invite, login, logout, me
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };

    // ─── Submit Registration Request ────────────────
    if (action === "register") {
      const { name, email, password } = body as {
        name: string;
        email: string;
        password: string;
      };

      if (!name?.trim() || !email?.trim() || !password) {
        return NextResponse.json({ error: "所有字段均为必填" }, { status: 400 });
      }

      if (password.length < 6) {
        return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
      }

      // Check if already a user
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return NextResponse.json({ error: "该邮箱已注册，请直接登录" }, { status: 400 });
      }

      // Check if pending
      const existingPending = await prisma.pendingRegistration.findUnique({ where: { email } });

      if (existingPending && existingPending.status === "pending") {
        return NextResponse.json(
          { error: "该邮箱已提交注册申请，请等待管理员审批" },
          { status: 400 }
        );
      }

      const inviteCode = generateInviteCode();
      const hashedPassword = await bcrypt.hash(password, 10);

      if (existingPending) {
        await prisma.pendingRegistration.update({
          where: { email },
          data: { name, password: hashedPassword, inviteCode, status: "pending" },
        });
      } else {
        await prisma.pendingRegistration.create({
          data: { name, email, password: hashedPassword, inviteCode },
        });
      }

      return NextResponse.json({ success: true });
    }

    // ─── Verify Invite Code ─────────────────────────
    if (action === "verify-invite") {
      const { email, inviteCode } = body as { email: string; inviteCode: string };

      if (!email?.trim() || !inviteCode?.trim()) {
        return NextResponse.json({ error: "请输入邮箱和邀请码" }, { status: 400 });
      }

      const pending = await prisma.pendingRegistration.findUnique({ where: { email } });

      if (!pending) {
        return NextResponse.json({ error: "未找到该邮箱的注册申请，请先注册" }, { status: 400 });
      }
      if (pending.status === "approved") {
        return NextResponse.json({ error: "该邮箱已完成注册，请直接登录" }, { status: 400 });
      }
      if (pending.status !== "pending") {
        return NextResponse.json({ error: "该注册申请已被处理，请重新申请" }, { status: 400 });
      }
      if (pending.inviteCode !== inviteCode.toUpperCase().trim()) {
        return NextResponse.json({ error: "邀请码错误" }, { status: 400 });
      }

      // Create user account
      const user = await prisma.user.create({
        data: { email: pending.email, name: pending.name, password: pending.password },
      });

      await prisma.pendingRegistration.update({
        where: { email },
        data: { status: "approved" },
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

    // ─── Login ───────────────────────────────────────
    if (action === "login") {
      const { email, password } = body as { email: string; password: string };

      if (!email?.trim() || !password) {
        return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.password) {
        return NextResponse.json({ error: "邮箱或密码错误" }, { status: 400 });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return NextResponse.json({ error: "邮箱或密码错误" }, { status: 400 });
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
      if (!userId) return NextResponse.json({ user: null });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return NextResponse.json({ user: null });
      return NextResponse.json({
        user: { id: user.id, name: user.name, email: user.email },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[auth]", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
