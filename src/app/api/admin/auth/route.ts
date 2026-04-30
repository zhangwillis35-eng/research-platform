import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

// Hard-coded admin credentials — only one admin account
const ADMIN_USER = "zhanglw56";
const ADMIN_PASS = "zhang040206A@";

// POST /api/admin/auth — login, logout, verify
export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body as { action: string };

  if (action === "login") {
    const { username, password } = body as { username: string; password: string };

    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }

    // Set admin session cookie (24h)
    const token = crypto.randomBytes(32).toString("hex");
    const cookieStore = await cookies();
    cookieStore.set("admin_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });

    // Store token in env-based memory (simple approach — no DB needed for single admin)
    globalAdminTokens.add(token);

    return NextResponse.json({ success: true });
  }

  if (action === "verify") {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (!token || !globalAdminTokens.has(token)) {
      return NextResponse.json({ authenticated: false });
    }
    return NextResponse.json({ authenticated: true });
  }

  if (action === "logout") {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (token) globalAdminTokens.delete(token);
    cookieStore.delete("admin_token");
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// In-memory token store (survives within the same server process)
const globalAdminTokens = new Set<string>();
