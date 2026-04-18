/**
 * Journal metadata enrichment — Lazy Scholar style.
 *
 * Strategy:
 * 1. Built-in database for SSCI/CAS classification (fixed lists)
 * 2. OpenAlex API for Impact Factor, SJR, subject category (real-time, any journal)
 * 3. ABS ranking for business/management journals
 */

export interface JournalMetadata {
  impactFactor?: number;
  hIndex?: number;
  sjrQuartile?: "Q1" | "Q2" | "Q3" | "Q4";
  absRating?: "4*" | "4" | "3" | "2" | "1";
  ssci: boolean;
  sci: boolean;
  casZone?: "一区" | "二区" | "三区" | "四区";
  isOpenAccess?: boolean;
  worksCount?: number;
}

// ─── ABS (Academic Journal Guide) Rating ─────────
// Comprehensive list covering ABS 1-4* for management/business

const ABS_RATINGS: Record<string, "4*" | "4" | "3" | "2" | "1"> = {
  // 4* (World Elite)
  "academy of management journal": "4*",
  "academy of management review": "4*",
  "administrative science quarterly": "4*",
  "american economic review": "4*",
  "econometrica": "4*",
  "information systems research": "4*",
  "journal of accounting and economics": "4*",
  "journal of accounting research": "4*",
  "journal of applied psychology": "4*",
  "journal of consumer research": "4*",
  "journal of finance": "4*",
  "journal of financial economics": "4*",
  "journal of marketing": "4*",
  "journal of marketing research": "4*",
  "journal of operations management": "4*",
  "journal of political economy": "4*",
  "management science": "4*",
  "marketing science": "4*",
  "mis quarterly": "4*",
  "operations research": "4*",
  "organization science": "4*",
  "quarterly journal of economics": "4*",
  "review of economic studies": "4*",
  "review of financial studies": "4*",
  "strategic management journal": "4*",
  "the accounting review": "4*",
  // 4
  "accounting organizations and society": "4",
  "british journal of management": "4",
  "contemporary accounting research": "4",
  "entrepreneurship theory and practice": "4",
  "human relations": "4",
  "human resource management": "4",
  "journal of business ethics": "4",
  "journal of business venturing": "4",
  "journal of consumer psychology": "4",
  "journal of international business studies": "4",
  "journal of management": "4",
  "journal of management information systems": "4",
  "journal of management studies": "4",
  "journal of organizational behavior": "4",
  "journal of the academy of marketing science": "4",
  "journal of world business": "4",
  "leadership quarterly": "4",
  "manufacturing and service operations management": "4",
  "organizational behavior and human decision processes": "4",
  "organizational research methods": "4",
  "organization studies": "4",
  "production and operations management": "4",
  "research policy": "4",
  "review of accounting studies": "4",
  "journal of financial and quantitative analysis": "4",
  "strategic entrepreneurship journal": "4",
  // 3
  "journal of business research": "3",
  "long range planning": "3",
  "journal of product innovation management": "3",
  "technovation": "3",
  "journal of supply chain management": "3",
  "global strategy journal": "3",
  "journal of international management": "3",
  "international journal of management reviews": "3",
  "international business review": "3",
  "european journal of operational research": "3",
  "journal of service research": "3",
  "journal of retailing": "3",
  "journal of business logistics": "3",
  "decision sciences": "3",
  "omega": "3",
  "international journal of operations and production management": "3",
  "personnel psychology": "3",
  "journal of occupational and organizational psychology": "3",
  "work and stress": "3",
  "finance research letters": "3",
  "journal of corporate finance": "3",
  "journal of banking and finance": "3",
  "journal of empirical finance": "3",
  "european financial management": "3",
  "financial management": "3",
  "international journal of research in marketing": "3",
  "psychology and marketing": "3",
  "journal of advertising": "3",
  "industrial marketing management": "3",
  "journal of interactive marketing": "3",
  "journal of strategic information systems": "3",
  "european journal of information systems": "3",
  "information and management": "3",
  "journal of information technology": "3",
  "journal of small business management": "3",
  "family business review": "3",
  "corporate governance an international review": "3",
  "journal of management inquiry": "3",
  "business strategy and the environment": "3",
  "group and organization management": "3",
  "international journal of human resource management": "3",
  "human resource management journal": "3",
  "human resource management review": "3",
  "asia pacific journal of management": "3",
  "management and organization review": "3",
  // 2
  "journal of business finance and accounting": "2",
  "international journal of management": "2",
  "management decision": "2",
  "european management journal": "2",
  "european management review": "2",
  "journal of general management": "2",
  "baltic journal of management": "2",
  "chinese management studies": "2",
  "cross cultural and strategic management": "2",
  "management international review": "2",
  "thunderbird international business review": "2",
  "multinational business review": "2",
  "international marketing review": "2",
  "journal of marketing management": "2",
  "journal of brand management": "2",
  "journal of knowledge management": "2",
  "journal of intellectual capital": "2",
  "technological forecasting and social change": "2",
  "technology analysis and strategic management": "2",
  "new technology work and employment": "2",
  "sustainability": "2",
  "corporate social responsibility and environmental management": "2",
};

// ─── SSCI Journals ───────────────────────────────

const SSCI_JOURNALS = new Set(Object.keys(ABS_RATINGS));
// Add extra SSCI journals not in ABS
["harvard business review", "sloan management review"].forEach((j) =>
  SSCI_JOURNALS.add(j)
);

// ─── 中科院分区 ──────────────────────────────────

const CAS_ZONE_MAP: Record<string, "一区" | "二区"> = {};
// Zone 1
for (const j of [
  "academy of management journal", "academy of management review", "administrative science quarterly",
  "strategic management journal", "management science", "journal of finance", "journal of financial economics",
  "review of financial studies", "journal of accounting and economics", "journal of accounting research",
  "the accounting review", "journal of marketing", "journal of marketing research", "journal of consumer research",
  "mis quarterly", "information systems research", "operations research", "organization science",
  "journal of applied psychology", "american economic review", "econometrica", "quarterly journal of economics",
  "journal of political economy", "review of economic studies",
]) CAS_ZONE_MAP[j] = "一区";
// Zone 2
for (const j of [
  "journal of management", "journal of management studies", "journal of international business studies",
  "organizational behavior and human decision processes", "journal of operations management", "marketing science",
  "journal of the academy of marketing science", "production and operations management",
  "manufacturing and service operations management", "journal of business venturing",
  "entrepreneurship theory and practice", "journal of business ethics", "contemporary accounting research",
  "review of accounting studies", "accounting organizations and society", "journal of management information systems",
  "journal of financial and quantitative analysis", "research policy", "human relations",
  "journal of organizational behavior", "leadership quarterly", "organization studies", "journal of world business",
  "british journal of management", "human resource management", "journal of business research", "long range planning",
  "journal of consumer psychology",
]) CAS_ZONE_MAP[j] = "二区";

// ─── Built-in IF (top journals only, fallback to OpenAlex) ──

const JOURNAL_IF: Record<string, number> = {
  "academy of management journal": 10.5, "academy of management review": 12.3,
  "administrative science quarterly": 9.2, "strategic management journal": 7.8,
  "management science": 5.4, "organization science": 5.0,
  "journal of management": 9.3, "journal of management studies": 8.6,
  "journal of international business studies": 8.6,
  "journal of finance": 8.0, "journal of financial economics": 8.2, "review of financial studies": 6.8,
  "journal of accounting and economics": 5.5, "journal of accounting research": 5.2, "the accounting review": 4.8,
  "journal of marketing": 12.9, "journal of marketing research": 6.1, "journal of consumer research": 7.2,
  "marketing science": 5.0, "journal of the academy of marketing science": 11.4,
  "mis quarterly": 7.3, "information systems research": 5.0, "journal of management information systems": 7.0,
  "journal of operations management": 7.8, "production and operations management": 5.2, "operations research": 3.2,
  "journal of applied psychology": 6.6, "journal of organizational behavior": 6.8, "leadership quarterly": 7.5,
  "journal of business venturing": 10.0, "entrepreneurship theory and practice": 10.5,
  "journal of business ethics": 6.6, "human relations": 5.7, "human resource management": 6.6,
  "organization studies": 5.1, "research policy": 9.5, "journal of world business": 8.9,
  "british journal of management": 5.6, "journal of business research": 10.5, "long range planning": 8.0,
  "finance research letters": 7.4, "journal of corporate finance": 6.1, "journal of banking and finance": 3.7,
  "european journal of operational research": 6.4, "journal of product innovation management": 6.0,
  "industrial marketing management": 8.2, "technovation": 11.1,
  "international journal of operations and production management": 6.5,
  "technological forecasting and social change": 12.9, "business strategy and the environment": 13.4,
  "corporate governance an international review": 5.3, "family business review": 8.3,
  "sustainability": 3.9, "international business review": 5.6,
  "american economic review": 12.2, "econometrica": 6.4, "quarterly journal of economics": 13.7,
  "journal of political economy": 10.3, "review of economic studies": 7.8,
  "harvard business review": 14.0, "sloan management review": 8.0,
  "南开管理评论": 5.1, "管理世界": 6.7, "经济研究": 7.2, "中国工业经济": 5.8,
};

// ─── Normalize + Match ───────────────────────────

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, "")
    .trim();
}

function findInMap<T>(venue: string, map: Record<string, T>): T | undefined {
  const n = normalize(venue);
  // Exact match first
  if (map[n] !== undefined) return map[n];
  // Substring match
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

  const absRating = findInMap(venue, ABS_RATINGS);
  const casZone = findInMap(venue, CAS_ZONE_MAP);
  const impactFactor = findInMap(venue, JOURNAL_IF);
  const ssci = matchesSet(venue, SSCI_JOURNALS);

  // Derive SJR quartile from ABS rating (rough mapping)
  let sjrQuartile: JournalMetadata["sjrQuartile"];
  if (absRating === "4*" || absRating === "4") sjrQuartile = "Q1";
  else if (absRating === "3") sjrQuartile = "Q1"; // ABS 3 journals are mostly SJR Q1
  else if (absRating === "2") sjrQuartile = "Q2";
  else if (absRating === "1") sjrQuartile = "Q3";

  return {
    impactFactor,
    absRating,
    ssci,
    sci: false,
    casZone,
    sjrQuartile,
  };
}

// ─── OpenAlex real-time enrichment (for unknown journals) ──

export async function enrichVenueFromOpenAlex(
  venue: string
): Promise<Partial<JournalMetadata>> {
  try {
    const res = await fetch(
      `https://api.openalex.org/sources?search=${encodeURIComponent(venue)}&per_page=1&select=display_name,summary_stats,h_index,is_oa,works_count,type`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const source = data.results?.[0];
    if (!source) return {};

    return {
      impactFactor: source.summary_stats?.["2yr_mean_citedness"] ?? undefined,
      hIndex: source.h_index ?? undefined,
      isOpenAccess: source.is_oa ?? undefined,
      worksCount: source.works_count ?? undefined,
    };
  } catch {
    return {};
  }
}

// ─── Batch enrich: fill gaps with OpenAlex ───────

export async function batchEnrichJournals(
  venues: string[]
): Promise<Map<string, Partial<JournalMetadata>>> {
  const results = new Map<string, Partial<JournalMetadata>>();
  const unknowns = venues.filter((v) => !findInMap(v, JOURNAL_IF));

  // Only query OpenAlex for journals not in our built-in DB
  const unique = [...new Set(unknowns)].slice(0, 10); // limit to 10 for speed

  const promises = unique.map(async (venue) => {
    const meta = await enrichVenueFromOpenAlex(venue);
    results.set(venue, meta);
  });

  await Promise.all(promises);
  return results;
}
