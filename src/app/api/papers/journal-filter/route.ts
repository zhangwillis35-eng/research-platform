import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeJournalName } from "@/lib/sources/journal-rankings";

// GET /api/papers/journal-filter?projectId=xxx
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  const [filters, project] = await Promise.all([
    prisma.journalFilter.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.researchProject.findUnique({
      where: { id: projectId },
      select: { journalFilterMode: true },
    }),
  ]);

  return NextResponse.json({
    filters,
    mode: project?.journalFilterMode ?? null,
  });
}

// POST /api/papers/journal-filter
// Body: { projectId, journals: string[], filterType: "blacklist"|"whitelist", source?: "manual"|"csv"|"preset" }
// OR:   { projectId, csv: string, filterType: "blacklist"|"whitelist" }
// OR:   { projectId, mode: "blacklist"|"whitelist"|null } — update mode only
export async function POST(request: Request) {
  const body = await request.json();
  const { projectId } = body;

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  // Mode-only update
  if ("mode" in body && !("journals" in body) && !("csv" in body)) {
    const mode = body.mode as string | null;
    if (mode !== null && mode !== "blacklist" && mode !== "whitelist") {
      return NextResponse.json({ error: "mode must be 'blacklist', 'whitelist', or null" }, { status: 400 });
    }
    await prisma.researchProject.update({
      where: { id: projectId },
      data: { journalFilterMode: mode },
    });
    return NextResponse.json({ ok: true, mode });
  }

  const filterType = body.filterType as string;
  if (filterType !== "blacklist" && filterType !== "whitelist") {
    return NextResponse.json({ error: "filterType must be 'blacklist' or 'whitelist'" }, { status: 400 });
  }

  let journals: string[] = [];
  const source = (body.source as string) ?? "manual";

  if (body.csv) {
    // Parse CSV: "journal_name,1/0" or just "journal_name" per line
    const lines = (body.csv as string).split(/\r?\n/).filter((l: string) => l.trim());
    for (const line of lines) {
      const parts = line.split(",").map((s: string) => s.trim());
      if (!parts[0]) continue;
      // If second column is "0", skip (excluded in PyPaperBot format)
      if (parts[1] === "0") continue;
      journals.push(parts[0]);
    }
  } else if (body.journals) {
    journals = body.journals as string[];
  } else {
    return NextResponse.json({ error: "journals array or csv string required" }, { status: 400 });
  }

  if (journals.length === 0) {
    return NextResponse.json({ error: "No valid journal names found" }, { status: 400 });
  }

  // Normalize and deduplicate
  const seen = new Set<string>();
  const toCreate: { projectId: string; journalName: string; filterType: string; source: string }[] = [];

  for (const j of journals) {
    const normalized = normalizeJournalName(j);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    toCreate.push({ projectId, journalName: j.trim(), filterType, source });
  }

  // Upsert: skip duplicates
  let created = 0;
  for (const item of toCreate) {
    try {
      await prisma.journalFilter.create({ data: item });
      created++;
    } catch {
      // Unique constraint violation — skip duplicate
    }
  }

  // Also set the filter mode if not already set
  await prisma.researchProject.update({
    where: { id: projectId },
    data: { journalFilterMode: filterType },
  });

  return NextResponse.json({ ok: true, created, total: toCreate.length });
}

// DELETE /api/papers/journal-filter
// Body: { projectId, filterId: string } OR { projectId, clearAll: true, filterType?: string }
export async function DELETE(request: Request) {
  const body = await request.json();
  const { projectId } = body;

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  if (body.clearAll) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { projectId };
    if (body.filterType) where.filterType = body.filterType;
    const { count } = await prisma.journalFilter.deleteMany({ where });

    // If clearing all, also reset mode
    if (!body.filterType) {
      await prisma.researchProject.update({
        where: { id: projectId },
        data: { journalFilterMode: null },
      });
    }

    return NextResponse.json({ ok: true, deleted: count });
  }

  if (body.filterId) {
    await prisma.journalFilter.delete({ where: { id: body.filterId } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "filterId or clearAll required" }, { status: 400 });
}
