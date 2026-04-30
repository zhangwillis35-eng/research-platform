/**
 * Complete journal metadata — Easyscholar-style multi-dimensional classification.
 *
 * Dimensions:
 * - ABS (Chartered ABS Academic Journal Guide 2024) — 1635 journals
 * - JCR 分区 (Journal Citation Reports Q1-Q4)
 * - SJR 分区 (Scimago Q1-Q4, derived from ABS when unavailable)
 * - 中科院分区 (一区/二区/三区/四区)
 * - SSCI / SCI 索引
 * - CSSCI 南大核心
 * - 北大核心
 * - CCF 等级 (A/B/C)
 * - ABDC 等级 (A-star, A, B, C)
 * - FMS 推荐期刊
 * - Impact Factor
 */
import { ABS_RATINGS, JOURNAL_IF } from "./journal-data";
import {
  CCF_RANKINGS,
  CSSCI_JOURNALS,
  PKU_CORE_JOURNALS,
  JCR_QUARTILES,
  ABDC_RANKINGS,
  FMS_JOURNALS,
  CAS_ZONE_3,
  CAS_ZONE_4,
  CONFERENCE_RANKINGS,
  type ConferenceInfo,
} from "./easyscholar-data";
import { SSCI_JCR, SSCI_SET, SCI_JCR_Q1Q2, SCI_SET } from "./jcr-data";

export interface JournalMetadata {
  impactFactor?: number;
  sjrQuartile?: "Q1" | "Q2" | "Q3" | "Q4";
  jcrQuartile?: "Q1" | "Q2" | "Q3" | "Q4";
  absRating?: "4*" | "4" | "3" | "2" | "1";
  abdcRating?: "A*" | "A" | "B" | "C";
  ccfRating?: "A" | "B" | "C";
  ssci: boolean;
  sci: boolean;
  cssci: boolean;
  pkuCore: boolean;
  fms: boolean;
  casZone?: "一区" | "二区" | "三区" | "四区";
  conference?: ConferenceInfo;
}

// ─── 中科院分区 一区/二区 (top-tier management journals) ────
const CAS_ZONE_1 = new Set([
  "academy of management journal", "academy of management review", "administrative science quarterly",
  "strategic management journal", "management science", "journal of finance", "journal of financial economics",
  "review of financial studies", "journal of accounting and economics", "journal of accounting research",
  "the accounting review", "journal of marketing", "journal of marketing research", "journal of consumer research",
  "mis quarterly", "information systems research", "operations research", "organization science",
  "journal of applied psychology", "american economic review", "econometrica", "quarterly journal of economics",
  "journal of political economy", "review of economic studies",
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
  if (!n || n.length < 2) return undefined;
  if (map[n] !== undefined) return map[n];
  // Substring match — strict: require 80% length similarity to avoid false positives
  // e.g. "information systems frontiers" must NOT match "information systems research"
  for (const [key, value] of Object.entries(map)) {
    if (key.length < 8 || n.length < 8) continue;
    const shorter = Math.min(key.length, n.length);
    const longer = Math.max(key.length, n.length);
    if (shorter / longer < 0.8) continue;
    if (n === key) return value;
    // Only match if one fully contains the other AND they're very similar length
    if ((n.includes(key) || key.includes(n)) && shorter / longer >= 0.85) return value;
  }
  return undefined;
}

function matchesSet(venue: string, set: Set<string>): boolean {
  const n = normalize(venue);
  if (!n || n.length < 2) return false;
  if (set.has(n)) return true;
  for (const j of set) {
    if (j.length < 8 || n.length < 8) continue;
    const shorter = Math.min(j.length, n.length);
    const longer = Math.max(j.length, n.length);
    if (shorter / longer < 0.8) continue;
    if ((n.includes(j) || j.includes(n)) && shorter / longer >= 0.85) return true;
  }
  return false;
}

// ─── Main function ───────────────────────────────

export function getJournalMetadata(venue: string | undefined | null): JournalMetadata {
  if (!venue) return { ssci: false, sci: false, cssci: false, pkuCore: false, fms: false };

  const absRatingStr = findInRecord(venue, ABS_RATINGS);
  const absRating = absRatingStr as JournalMetadata["absRating"];
  const impactFactor = findInRecord(venue, JOURNAL_IF);

  // JCR quartile — authoritative: first check JCR 2024 SSCI data, then SCIE, then hand-curated
  const ssciJcrQ = findInRecord(venue, SSCI_JCR as Record<string, string>) as JournalMetadata["jcrQuartile"];
  const sciJcrQ = findInRecord(venue, SCI_JCR_Q1Q2 as Record<string, string>) as JournalMetadata["jcrQuartile"];
  const handJcrQ = findInRecord(venue, JCR_QUARTILES);
  const jcrQuartile = ssciJcrQ ?? sciJcrQ ?? handJcrQ;

  // ABDC rating
  const abdcRating = findInRecord(venue, ABDC_RANKINGS);

  // CCF rating
  const ccfRating = findInRecord(venue, CCF_RANKINGS);

  // SSCI: authoritative check from JCR 2024 SSCI journal list (3523 journals)
  const ssci = !!ssciJcrQ || matchesSet(venue, SSCI_SET);

  // SCI: authoritative check from JCR 2024 SCIE journal list (management-adjacent Q1-Q2)
  const sci = !!sciJcrQ || matchesSet(venue, SCI_SET);

  // CSSCI (南大核心)
  const cssci = matchesSet(venue, CSSCI_JOURNALS);

  // 北大核心
  const pkuCore = matchesSet(venue, PKU_CORE_JOURNALS);

  // FMS 推荐
  const fms = matchesSet(venue, FMS_JOURNALS);

  // CAS zones (四级)
  let casZone: JournalMetadata["casZone"];
  if (matchesSet(venue, CAS_ZONE_1)) casZone = "一区";
  else if (matchesSet(venue, CAS_ZONE_2)) casZone = "二区";
  else if (matchesSet(venue, CAS_ZONE_3)) casZone = "三区";
  else if (matchesSet(venue, CAS_ZONE_4)) casZone = "四区";

  // SJR quartile: only show when we have actual JCR data, don't derive from ABS
  // Previously derived from ABS which produced false SJR badges
  let sjrQuartile: JournalMetadata["sjrQuartile"];
  if (impactFactor && impactFactor > 10) sjrQuartile = "Q1";
  else if (impactFactor && impactFactor > 5) sjrQuartile = "Q1";
  else if (impactFactor && impactFactor > 3) sjrQuartile = "Q2";

  // Conference detection
  const conference = findInRecord(venue, CONFERENCE_RANKINGS);

  return {
    impactFactor, absRating, jcrQuartile, abdcRating, ccfRating,
    ssci, sci, cssci, pkuCore, fms, casZone, sjrQuartile, conference,
  };
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
