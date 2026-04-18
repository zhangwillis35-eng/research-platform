import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";

// POST /api/auth — login or register
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, email, name } = body as {
      action: "login" | "logout" | "me";
      email?: string;
      name?: string;
    };

    if (action === "login") {
      if (!email) {
        return NextResponse.json({ error: "Email required" }, { status: 400 });
      }

      const user = await prisma.user.upsert({
        where: { email },
        update: { name: name || undefined },
        create: { email, name },
      });

      // Set simple session cookie
      const cookieStore = await cookies();
      cookieStore.set("user_id", user.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: "/",
      });

      return NextResponse.json({ user });
    }

    if (action === "logout") {
      const cookieStore = await cookies();
      cookieStore.delete("user_id");
      return NextResponse.json({ success: true });
    }

    if (action === "me") {
      const cookieStore = await cookies();
      const userId = cookieStore.get("user_id")?.value;
      if (!userId) {
        return NextResponse.json({ user: null });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      return NextResponse.json({ user });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "Auth error", details: String(error) },
      { status: 500 }
    );
  }
}
