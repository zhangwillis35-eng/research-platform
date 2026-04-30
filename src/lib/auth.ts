import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "./db";

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
}

/**
 * Read the current session user from the httpOnly cookie.
 * Returns null if not logged in or user no longer exists.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const userId = cookieStore.get("user_id")?.value;
  if (!userId) return null;

  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
}

/**
 * Require authentication. Returns the user or a 401 Response.
 *
 * Usage:
 *   const auth = await requireAuth();
 *   if (auth instanceof NextResponse) return auth;
 *   // auth is SessionUser
 */
export async function requireAuth(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  return user;
}

/**
 * Require authentication + project ownership.
 * Returns the user or a 401/403 Response.
 *
 * Usage:
 *   const auth = await requireProjectAccess(projectId);
 *   if (auth instanceof NextResponse) return auth;
 *   // auth is SessionUser
 */
export async function requireProjectAccess(
  projectId: string
): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const project = await prisma.researchProject.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });

  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "无权访问该项目" }, { status: 403 });
  }

  return user;
}
