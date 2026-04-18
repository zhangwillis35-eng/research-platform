// FT50 — Financial Times Top 50 Business Journals (2024 list)
const FT50_JOURNALS = new Set([
  // Accounting
  "The Accounting Review",
  "Accounting, Organizations and Society",
  "Contemporary Accounting Research",
  "Journal of Accounting and Economics",
  "Journal of Accounting Research",
  "Review of Accounting Studies",
  // Economics
  "American Economic Review",
  "Econometrica",
  "Journal of Political Economy",
  "Quarterly Journal of Economics",
  "Review of Economic Studies",
  "Review of Financial Studies",
  // Entrepreneurship
  "Entrepreneurship Theory and Practice",
  "Journal of Business Venturing",
  // Ethics
  "Journal of Business Ethics",
  // Finance
  "Journal of Finance",
  "Journal of Financial Economics",
  "Journal of Financial and Quantitative Analysis",
  // Information Systems
  "Information Systems Research",
  "Journal of Management Information Systems",
  "MIS Quarterly",
  // International Business
  "Journal of International Business Studies",
  "Journal of World Business",
  // Management
  "Academy of Management Journal",
  "Academy of Management Review",
  "Administrative Science Quarterly",
  "British Journal of Management",
  "Journal of Management",
  "Journal of Management Studies",
  "Strategic Management Journal",
  // Marketing
  "Journal of Consumer Psychology",
  "Journal of Consumer Research",
  "Journal of Marketing",
  "Journal of Marketing Research",
  "Journal of the Academy of Marketing Science",
  "Marketing Science",
  // Operations & Supply Chain
  "Journal of Operations Management",
  "Management Science",
  "Manufacturing & Service Operations Management",
  "Operations Research",
  "Production and Operations Management",
  // Organizational Behavior / HR
  "Human Relations",
  "Human Resource Management",
  "Journal of Applied Psychology",
  "Organizational Behavior and Human Decision Processes",
  "Organization Science",
  "Organization Studies",
  // Research Methods
  "Organizational Research Methods",
  // Strategy
  "Strategic Entrepreneurship Journal",
  // General
  "Harvard Business Review",
  "Sloan Management Review",
]);

// UTD24 — UT Dallas Top 24 Business School Research Rankings Journals
const UTD24_JOURNALS = new Set([
  "The Accounting Review",
  "Journal of Accounting and Economics",
  "Journal of Accounting Research",
  "Journal of Finance",
  "Journal of Financial Economics",
  "Review of Financial Studies",
  "Information Systems Research",
  "Journal of Management Information Systems",
  "MIS Quarterly",
  "Journal of International Business Studies",
  "Academy of Management Journal",
  "Academy of Management Review",
  "Administrative Science Quarterly",
  "Journal of Management",
  "Strategic Management Journal",
  "Journal of Consumer Research",
  "Journal of Marketing",
  "Journal of Marketing Research",
  "Marketing Science",
  "Management Science",
  "Manufacturing & Service Operations Management",
  "Operations Research",
  "Production and Operations Management",
  "Organization Science",
]);

// ABS (Chartered Association of Business Schools) 4* journals
const ABS4STAR_JOURNALS = new Set([
  "Academy of Management Journal",
  "Academy of Management Review",
  "Administrative Science Quarterly",
  "American Economic Review",
  "Econometrica",
  "Information Systems Research",
  "Journal of Accounting and Economics",
  "Journal of Accounting Research",
  "Journal of Applied Psychology",
  "Journal of Consumer Research",
  "Journal of Finance",
  "Journal of Financial Economics",
  "Journal of Marketing",
  "Journal of Marketing Research",
  "Journal of Operations Management",
  "Journal of Political Economy",
  "Management Science",
  "Marketing Science",
  "MIS Quarterly",
  "Operations Research",
  "Organization Science",
  "Quarterly Journal of Economics",
  "Review of Economic Studies",
  "Review of Financial Studies",
  "Strategic Management Journal",
  "The Accounting Review",
]);

export interface JournalRanking {
  ft50: boolean;
  utd24: boolean;
  abs4star: boolean;
}

// Normalize journal name for matching
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

// Build normalized lookup maps
function buildNormalizedSet(journals: Set<string>): Set<string> {
  const normalized = new Set<string>();
  for (const j of journals) {
    normalized.add(normalize(j));
  }
  return normalized;
}

const ft50Normalized = buildNormalizedSet(FT50_JOURNALS);
const utd24Normalized = buildNormalizedSet(UTD24_JOURNALS);
const abs4starNormalized = buildNormalizedSet(ABS4STAR_JOURNALS);

export function getJournalRanking(venue: string | undefined | null): JournalRanking {
  if (!venue) return { ft50: false, utd24: false, abs4star: false };

  const normalized = normalize(venue);

  // Try exact match first, then substring match
  const matchesSet = (set: Set<string>) => {
    if (set.has(normalized)) return true;
    for (const j of set) {
      if (normalized.includes(j) || j.includes(normalized)) return true;
    }
    return false;
  };

  return {
    ft50: matchesSet(ft50Normalized),
    utd24: matchesSet(utd24Normalized),
    abs4star: matchesSet(abs4starNormalized),
  };
}

export function getRankingBadges(venue: string | undefined | null): string[] {
  const ranking = getJournalRanking(venue);
  const badges: string[] = [];
  if (ranking.utd24) badges.push("UTD24");
  if (ranking.ft50) badges.push("FT50");
  if (ranking.abs4star) badges.push("ABS 4*");
  return badges;
}
