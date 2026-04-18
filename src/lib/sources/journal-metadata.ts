/**
 * Journal metadata enrichment.
 *
 * Sources:
 * 1. OpenAlex API — 2-year mean citedness (≈IF), h-index, type
 * 2. Built-in SSCI/SCI classification
 * 3. Built-in 中科院分区 (CAS zones) for major management journals
 * 4. SJR quartile from built-in data
 */

export interface JournalMetadata {
  impactFactor?: number;    // 2-year mean citedness from OpenAlex
  hIndex?: number;
  sjrQuartile?: "Q1" | "Q2" | "Q3" | "Q4";
  ssci: boolean;
  sci: boolean;
  casZone?: "一区" | "二区" | "三区" | "四区";  // 中科院分区
  publisher?: string;
}

// ─── SSCI Core Management Journals ───────────────

const SSCI_JOURNALS = new Set([
  "academy of management journal",
  "academy of management review",
  "administrative science quarterly",
  "strategic management journal",
  "organization science",
  "journal of management",
  "journal of management studies",
  "journal of international business studies",
  "management science",
  "journal of applied psychology",
  "organizational behavior and human decision processes",
  "journal of marketing",
  "journal of marketing research",
  "journal of consumer research",
  "journal of consumer psychology",
  "journal of the academy of marketing science",
  "marketing science",
  "journal of finance",
  "journal of financial economics",
  "review of financial studies",
  "journal of accounting research",
  "journal of accounting and economics",
  "the accounting review",
  "accounting organizations and society",
  "contemporary accounting research",
  "review of accounting studies",
  "mis quarterly",
  "information systems research",
  "journal of management information systems",
  "journal of operations management",
  "production and operations management",
  "manufacturing and service operations management",
  "operations research",
  "journal of business venturing",
  "entrepreneurship theory and practice",
  "strategic entrepreneurship journal",
  "journal of business ethics",
  "journal of world business",
  "human relations",
  "human resource management",
  "organization studies",
  "organizational research methods",
  "british journal of management",
  "journal of organizational behavior",
  "leadership quarterly",
  "research policy",
  "technovation",
  "journal of product innovation management",
  "journal of business research",
  "long range planning",
  "international journal of management reviews",
  "journal of supply chain management",
  "journal of international management",
  "global strategy journal",
  "american economic review",
  "econometrica",
  "quarterly journal of economics",
  "journal of political economy",
  "review of economic studies",
  "journal of financial and quantitative analysis",
  "harvard business review",
  "sloan management review",
]);

// ─── 中科院分区 (Major Management Journals) ──────

const CAS_ZONE_1: Set<string> = new Set([
  "academy of management journal",
  "academy of management review",
  "administrative science quarterly",
  "strategic management journal",
  "management science",
  "journal of finance",
  "journal of financial economics",
  "review of financial studies",
  "journal of accounting and economics",
  "journal of accounting research",
  "the accounting review",
  "journal of marketing",
  "journal of marketing research",
  "journal of consumer research",
  "mis quarterly",
  "information systems research",
  "operations research",
  "organization science",
  "journal of applied psychology",
  "american economic review",
  "econometrica",
  "quarterly journal of economics",
  "journal of political economy",
  "review of economic studies",
]);

const CAS_ZONE_2: Set<string> = new Set([
  "journal of management",
  "journal of management studies",
  "journal of international business studies",
  "organizational behavior and human decision processes",
  "journal of operations management",
  "marketing science",
  "journal of the academy of marketing science",
  "journal of consumer psychology",
  "production and operations management",
  "manufacturing and service operations management",
  "journal of business venturing",
  "entrepreneurship theory and practice",
  "journal of business ethics",
  "contemporary accounting research",
  "review of accounting studies",
  "accounting organizations and society",
  "journal of management information systems",
  "journal of financial and quantitative analysis",
  "research policy",
  "human relations",
  "journal of organizational behavior",
  "leadership quarterly",
  "organization studies",
  "journal of world business",
  "british journal of management",
  "human resource management",
  "journal of business research",
  "long range planning",
]);

// ─── SJR Quartile (Top Management Journals) ─────

const SJR_Q1: Set<string> = new Set([
  ...Array.from(CAS_ZONE_1),
  "journal of management",
  "journal of management studies",
  "journal of international business studies",
  "organizational behavior and human decision processes",
  "journal of operations management",
  "marketing science",
  "journal of the academy of marketing science",
  "research policy",
  "journal of organizational behavior",
]);

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function matchesSet(venue: string, set: Set<string>): boolean {
  const n = normalize(venue);
  for (const j of set) {
    if (n.includes(j) || j.includes(n)) return true;
  }
  return false;
}

export function getJournalMetadata(venue: string | undefined | null): JournalMetadata {
  if (!venue) return { ssci: false, sci: false };

  return {
    ssci: matchesSet(venue, SSCI_JOURNALS),
    sci: false, // SCI is for natural sciences, not management
    casZone: matchesSet(venue, CAS_ZONE_1)
      ? "一区"
      : matchesSet(venue, CAS_ZONE_2)
        ? "二区"
        : undefined,
    sjrQuartile: matchesSet(venue, SJR_Q1) ? "Q1" : undefined,
  };
}

// ─── OpenAlex journal metrics enrichment ─────────

export async function enrichWithOpenAlexMetrics(
  venue: string
): Promise<{ impactFactor?: number; hIndex?: number }> {
  try {
    const params = new URLSearchParams({
      search: venue,
      per_page: "1",
      select: "display_name,summary_stats,h_index",
    });

    const res = await fetch(`https://api.openalex.org/sources?${params}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return {};

    const data = await res.json();
    const source = data.results?.[0];
    if (!source) return {};

    return {
      impactFactor: source.summary_stats?.["2yr_mean_citedness"] ?? undefined,
      hIndex: source.h_index ?? undefined,
    };
  } catch {
    return {};
  }
}
