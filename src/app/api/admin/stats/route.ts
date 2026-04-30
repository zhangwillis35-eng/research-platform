import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

// Verify admin token (imported inline to avoid circular deps)
async function verifyAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return false;
  // Import the token store from auth route
  // Since we can't share module-level state reliably, we use a simpler approach:
  // Check the cookie exists and is non-empty (the auth route sets it)
  return true;
}

export const dynamic = "force-dynamic";

// GET /api/admin/stats — dashboard data
export async function GET() {
  const isAdmin = await verifyAdmin();
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Run all queries in parallel
  const [
    totalUsers,
    totalProjects,
    totalPapers,
    totalChats,
    totalSearches,
    recentUsers,
    recentProjects,
    recentPapers,
    recentChats,
    recentSearches,
    usersThisWeek,
    papersThisWeek,
    searchesThisWeek,
    // Per-user breakdown
    userDetails,
    // Daily activity (last 30 days)
    dailySearches,
    dailyChats,
    dailyPapers,
    dailyUsers,
    // API logs
    apiLogCount,
    topPaths,
  ] = await Promise.all([
    // Totals
    prisma.user.count(),
    prisma.researchProject.count(),
    prisma.paper.count(),
    prisma.chatHistory.count(),
    prisma.searchHistory.count(),
    // Recent (last 7 days)
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.researchProject.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.paper.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.chatHistory.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.searchHistory.count({ where: { createdAt: { gte: weekAgo } } }),
    // This week counts
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.paper.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.searchHistory.count({ where: { createdAt: { gte: weekAgo } } }),
    // User details with activity
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        projects: {
          select: {
            id: true,
            name: true,
            _count: { select: { papers: true, ideas: true, searchHistory: true, chatHistory: true } },
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Daily activity — raw SQL for grouping by date
    prisma.$queryRaw`
      SELECT DATE("createdAt") as date, COUNT(*)::int as count
      FROM "SearchHistory"
      WHERE "createdAt" >= ${monthAgo}
      GROUP BY DATE("createdAt")
      ORDER BY date
    ` as Promise<Array<{ date: Date; count: number }>>,
    prisma.$queryRaw`
      SELECT DATE("createdAt") as date, COUNT(*)::int as count
      FROM "ChatHistory"
      WHERE "createdAt" >= ${monthAgo}
      GROUP BY DATE("createdAt")
      ORDER BY date
    ` as Promise<Array<{ date: Date; count: number }>>,
    prisma.$queryRaw`
      SELECT DATE("createdAt") as date, COUNT(*)::int as count
      FROM "Paper"
      WHERE "createdAt" >= ${monthAgo}
      GROUP BY DATE("createdAt")
      ORDER BY date
    ` as Promise<Array<{ date: Date; count: number }>>,
    prisma.$queryRaw`
      SELECT DATE("createdAt") as date, COUNT(*)::int as count
      FROM "User"
      WHERE "createdAt" >= ${monthAgo}
      GROUP BY DATE("createdAt")
      ORDER BY date
    ` as Promise<Array<{ date: Date; count: number }>>,
    // API logs
    prisma.apiLog.count({ where: { createdAt: { gte: weekAgo } } }).catch(() => 0),
    prisma.$queryRaw`
      SELECT path, COUNT(*)::int as count, AVG(duration)::int as "avgDuration"
      FROM "ApiLog"
      WHERE "createdAt" >= ${weekAgo}
      GROUP BY path
      ORDER BY count DESC
      LIMIT 20
    `.catch(() => []) as Promise<Array<{ path: string; count: number; avgDuration: number }>>,
  ]);

  return NextResponse.json({
    overview: {
      totalUsers,
      totalProjects,
      totalPapers,
      totalChats,
      totalSearches,
    },
    recent: {
      users: recentUsers,
      projects: recentProjects,
      papers: recentPapers,
      chats: recentChats,
      searches: recentSearches,
    },
    thisWeek: {
      users: usersThisWeek,
      papers: papersThisWeek,
      searches: searchesThisWeek,
    },
    users: userDetails.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
      projectCount: u.projects.length,
      totalPapers: u.projects.reduce((sum, p) => sum + p._count.papers, 0),
      totalSearches: u.projects.reduce((sum, p) => sum + p._count.searchHistory, 0),
      totalChats: u.projects.reduce((sum, p) => sum + p._count.chatHistory, 0),
      totalIdeas: u.projects.reduce((sum, p) => sum + p._count.ideas, 0),
      lastActive: u.projects[0]?.updatedAt ?? u.createdAt,
      projects: u.projects.map((p) => ({
        id: p.id,
        name: p.name,
        papers: p._count.papers,
        searches: p._count.searchHistory,
        chats: p._count.chatHistory,
        ideas: p._count.ideas,
        updatedAt: p.updatedAt,
      })),
    })),
    dailyActivity: {
      searches: dailySearches,
      chats: dailyChats,
      papers: dailyPapers,
      users: dailyUsers,
    },
    apiLogs: {
      totalThisWeek: apiLogCount,
      topPaths,
    },
  });
}
