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

// ─── Built-in Impact Factors (JCR 2024 approximate) ──

const JOURNAL_IF: Record<string, number> = {
  "academy of management journal": 10.5,
  "academy of management review": 12.3,
  "administrative science quarterly": 9.2,
  "strategic management journal": 7.8,
  "management science": 5.4,
  "organization science": 5.0,
  "journal of management": 9.3,
  "journal of management studies": 8.6,
  "journal of international business studies": 8.6,
  "journal of finance": 8.0,
  "journal of financial economics": 8.2,
  "review of financial studies": 6.8,
  "journal of accounting and economics": 5.5,
  "journal of accounting research": 5.2,
  "the accounting review": 4.8,
  "journal of marketing": 12.9,
  "journal of marketing research": 6.1,
  "journal of consumer research": 7.2,
  "journal of consumer psychology": 4.8,
  "marketing science": 5.0,
  "journal of the academy of marketing science": 11.4,
  "mis quarterly": 7.3,
  "information systems research": 5.0,
  "journal of management information systems": 7.0,
  "journal of operations management": 7.8,
  "production and operations management": 5.2,
  "manufacturing and service operations management": 4.6,
  "operations research": 3.2,
  "journal of applied psychology": 6.6,
  "organizational behavior and human decision processes": 4.6,
  "journal of organizational behavior": 6.8,
  "leadership quarterly": 7.5,
  "journal of business venturing": 10.0,
  "entrepreneurship theory and practice": 10.5,
  "journal of business ethics": 6.6,
  "human relations": 5.7,
  "human resource management": 6.6,
  "organization studies": 5.1,
  "research policy": 9.5,
  "journal of world business": 8.9,
  "british journal of management": 5.6,
  "journal of business research": 10.5,
  "long range planning": 8.0,
  "journal of product innovation management": 6.0,
  "journal of supply chain management": 7.9,
  "global strategy journal": 5.7,
  "american economic review": 12.2,
  "econometrica": 6.4,
  "quarterly journal of economics": 13.7,
  "journal of political economy": 10.3,
  "review of economic studies": 7.8,
  "accounting organizations and society": 4.4,
  "contemporary accounting research": 3.6,
  "review of accounting studies": 3.8,
  "harvard business review": 14.0,
  "sloan management review": 8.0,
  "journal of financial and quantitative analysis": 3.4,
  "strategic entrepreneurship journal": 5.4,
  "organizational research methods": 8.9,
  "finance research letters": 7.4,
  "南开管理评论": 5.1,
  "管理世界": 6.7,
  "经济研究": 7.2,
  "中国工业经济": 5.8,
  "管理科学学报": 3.5,
  "中国管理科学": 3.2,
  "会计研究": 4.5,
  "金融研究": 5.0,
  "经济学季刊": 4.8,
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, "")
    .trim();
}

function matchesSet(venue: string, set: Set<string>): boolean {
  const n = normalize(venue);
  for (const j of set) {
    if (n.includes(j) || j.includes(n)) return true;
  }
  return false;
}

function findIF(venue: string): number | undefined {
  const n = normalize(venue);
  for (const [journal, ifValue] of Object.entries(JOURNAL_IF)) {
    if (n.includes(journal) || journal.includes(n)) return ifValue;
  }
  return undefined;
}

export function getJournalMetadata(venue: string | undefined | null): JournalMetadata {
  if (!venue) return { ssci: false, sci: false };

  return {
    impactFactor: findIF(venue),
    ssci: matchesSet(venue, SSCI_JOURNALS),
    sci: false,
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
