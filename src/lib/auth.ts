import { cookies } from "next/headers";
import { prisma } from "./db";

export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
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
