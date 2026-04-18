/**
 * Complete journal metadata — 1635 ABS journals + 200+ IF journals.
 * Data from ABS Academic Journal Guide 2024 + OpenAlex.
 */
import { ABS_RATINGS, JOURNAL_IF } from "./journal-data";

export interface JournalMetadata {
  impactFactor?: number;
  sjrQuartile?: "Q1" | "Q2" | "Q3" | "Q4";
  absRating?: "4*" | "4" | "3" | "2" | "1";
  ssci: boolean;
  sci: boolean;
  casZone?: "一区" | "二区" | "三区" | "四区";
}

// ─── 中科院分区 (management journals) ────────────

const CAS_ZONE_1 = new Set([
  "academy of management journal", "academy of management review", "administrative science quarterly",
  "strategic management journal", "management science", "journal of finance", "journal of financial economics",
  "review of financial studies", "journal of accounting and economics", "journal of accounting research",
  "the accounting review", "journal of marketing", "journal of marketing research", "journal of consumer research",
  "mis quarterly", "information systems research", "operations research", "organization science",
  "journal of applied psychology", "american economic review", "econometrica", "quarterly journal of economics",
  "journal of political economy", "review of economic studies",
  // Top science journals
  "nature", "science", "cell", "the lancet", "new england journal of medicine",
]);

const CAS_ZONE_2 = new Set([
  "journal of management", "journal of management studies", "journal of international business studies",
  "organizational behavior and human decision processes", "journal of operations management", "marketing science",
  "journal of the academy of marketing science", "production and operations management",
  "journal of business venturing", "entrepreneurship theory and practice", "journal of business ethics",
  "contemporary accounting research", "review of accounting studies", "accounting organizations and society",
  "journal of management information systems", "journal of financial and quantitative analysis",
  "research policy", "human relations", "journal of organizational behavior", "leadership quarterly",
  "organization studies", "journal of world business", "british journal of management",
  "human resource management", "journal of business research", "journal of consumer psychology",
  // Science journals
  "nature medicine", "nature materials", "nature nanotechnology", "nature methods",
  "advanced materials", "energy & environmental science", "chemical reviews",
]);

// ─── Normalize + Match ───────────────────────────

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, "")
    .trim();
}

function findInRecord<T>(venue: string, map: Record<string, T>): T | undefined {
  const n = normalize(venue);
  if (map[n] !== undefined) return map[n];
  // Try substring match for partial names
  for (const [key, value] of Object.entries(map)) {
    if (n.includes(key) || key.includes(n)) return value;
  }
  return undefined;
}

function matchesSet(venue: string, set: Set<string>): boolean {
  const n = normalize(venue);
  if (set.has(n)) return true;
  for (const j of set) {
    if (n.includes(j) || j.includes(n)) return true;
  }
  return false;
}

// ─── Main function ───────────────────────────────

export function getJournalMetadata(venue: string | undefined | null): JournalMetadata {
  if (!venue) return { ssci: false, sci: false };

  const absRatingStr = findInRecord(venue, ABS_RATINGS);
  const absRating = absRatingStr as JournalMetadata["absRating"];
  const impactFactor = findInRecord(venue, JOURNAL_IF);

  // SSCI = any journal in ABS list (business/social science)
  const ssci = !!absRatingStr;

  // CAS zones
  const casZone = matchesSet(venue, CAS_ZONE_1)
    ? "一区" as const
    : matchesSet(venue, CAS_ZONE_2)
      ? "二区" as const
      : undefined;

  // Derive SJR from ABS (rough but useful)
  let sjrQuartile: JournalMetadata["sjrQuartile"];
  if (absRating === "4*" || absRating === "4") sjrQuartile = "Q1";
  else if (absRating === "3") sjrQuartile = "Q1";
  else if (absRating === "2") sjrQuartile = "Q2";
  else if (absRating === "1") sjrQuartile = "Q3";
  // For non-ABS journals with high IF, assume Q1
  else if (impactFactor && impactFactor > 10) sjrQuartile = "Q1";
  else if (impactFactor && impactFactor > 5) sjrQuartile = "Q2";

  // SCI for natural science journals (detected by IF but not in ABS)
  const sci = !ssci && !!impactFactor && impactFactor > 3;

  return { impactFactor, absRating, ssci, sci, casZone, sjrQuartile };
}

// ─── OpenAlex fallback for truly unknown journals ──

export async function enrichVenueFromOpenAlex(
  venue: string
): Promise<Partial<JournalMetadata>> {
  try {
    const res = await fetch(
      `https://api.openalex.org/sources?search=${encodeURIComponent(venue)}&per_page=1&select=display_name,summary_stats,h_index,is_oa`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const source = data.results?.[0];
    if (!source) return {};
    const ifVal = source.summary_stats?.["2yr_mean_citedness"];
    if (ifVal && ifVal > 100) return {}; // filter anomalies
    return { impactFactor: ifVal ? Math.round(ifVal * 10) / 10 : undefined };
  } catch {
    return {};
  }
}

export async function batchEnrichJournals(
  venues: string[]
): Promise<Map<string, Partial<JournalMetadata>>> {
  const results = new Map<string, Partial<JournalMetadata>>();
  const unknowns = venues.filter((v) => !findInRecord(v, JOURNAL_IF));
  const unique = [...new Set(unknowns)].slice(0, 10);
  await Promise.all(
    unique.map(async (venue) => {
      const meta = await enrichVenueFromOpenAlex(venue);
      results.set(venue, meta);
    })
  );
  return results;
}
