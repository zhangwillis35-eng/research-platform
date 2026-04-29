// FT50 — Financial Times Top 50 Business Journals (2024 list)
// Source: https://www.ft.com/ft-top-50-journals
const FT50_JOURNALS = new Set([
  // Accounting (6)
  "The Accounting Review",
  "Accounting, Organizations and Society",
  "Contemporary Accounting Research",
  "Journal of Accounting and Economics",
  "Journal of Accounting Research",
  "Review of Accounting Studies",
  // Economics (5)
  "American Economic Review",
  "Econometrica",
  "Journal of Political Economy",
  "Quarterly Journal of Economics",
  "Review of Economic Studies",
  // Entrepreneurship (2)
  "Entrepreneurship Theory and Practice",
  "Journal of Business Venturing",
  // Ethics (1)
  "Journal of Business Ethics",
  // Finance (4)
  "Journal of Finance",
  "Journal of Financial Economics",
  "Journal of Financial and Quantitative Analysis",
  "Review of Financial Studies",
  // Information Systems (3)
  "Information Systems Research",
  "Journal of Management Information Systems",
  "MIS Quarterly",
  // International Business (2)
  "Journal of International Business Studies",
  "Journal of World Business",
  // Management (5)
  "Academy of Management Journal",
  "Academy of Management Review",
  "Administrative Science Quarterly",
  "Journal of Management",
  "Journal of Management Studies",
  "Strategic Management Journal",
  // Marketing (6)
  "Journal of Consumer Psychology",
  "Journal of Consumer Research",
  "Journal of Marketing",
  "Journal of Marketing Research",
  "Journal of the Academy of Marketing Science",
  "Marketing Science",
  // Operations & Supply Chain (5)
  "Journal of Operations Management",
  "Management Science",
  "Manufacturing & Service Operations Management",
  "Operations Research",
  "Production and Operations Management",
  // Organizational Behavior / HR (6)
  "Human Relations",
  "Human Resource Management",
  "Journal of Applied Psychology",
  "Organizational Behavior and Human Decision Processes",
  "Organization Science",
  "Organization Studies",
  // Innovation (1)
  "Research Policy",
  // Strategy (1)
  "Strategic Entrepreneurship Journal",
  // General (2)
  "Harvard Business Review",
  "MIT Sloan Management Review",
]);

// UTD24 — UT Dallas Top 24 Business School Research Rankings Journals
// Source: https://jsom.utdallas.edu/the-utd-top-100-business-school-research-rankings/
const UTD24_JOURNALS = new Set([
  // Accounting (3)
  "The Accounting Review",
  "Journal of Accounting and Economics",
  "Journal of Accounting Research",
  // Finance (3)
  "Journal of Finance",
  "Journal of Financial Economics",
  "Review of Financial Studies",
  // Information Systems (3)
  "Information Systems Research",
  "INFORMS Journal on Computing",
  "MIS Quarterly",
  // International Business (1)
  "Journal of International Business Studies",
  // Management (4)
  "Academy of Management Journal",
  "Academy of Management Review",
  "Administrative Science Quarterly",
  "Management Science",
  "Strategic Management Journal",
  // Marketing (4)
  "Journal of Consumer Research",
  "Journal of Marketing",
  "Journal of Marketing Research",
  "Marketing Science",
  // Operations Management (4)
  "Journal of Operations Management",
  "Manufacturing & Service Operations Management",
  "Operations Research",
  "Production and Operations Management",
  // Organization Science (1)
  "Organization Science",
]);

// ABS (Chartered Association of Business Schools) 4* Journals of Distinction
// Source: Chartered ABS Academic Journal Guide 2024
// Full list of 45 journals rated 4* (Journal of Distinction)
const ABS4STAR_JOURNALS = new Set([
  // Accounting
  "The Accounting Review",
  "Accounting, Organizations and Society",
  "Journal of Accounting and Economics",
  "Journal of Accounting Research",
  // Economics & Statistics
  "American Economic Review",
  "Econometrica",
  "Journal of Political Economy",
  "Quarterly Journal of Economics",
  "Review of Economic Studies",
  "Annals of Statistics",
  // Entrepreneurship
  "Entrepreneurship Theory and Practice",
  "Journal of Business Venturing",
  // Finance
  "Journal of Finance",
  "Journal of Financial Economics",
  "Review of Financial Studies",
  // General Management
  "Academy of Management Annals",
  "Academy of Management Journal",
  "Academy of Management Learning and Education",
  "Academy of Management Review",
  "Administrative Science Quarterly",
  "Journal of Management",
  "Strategic Management Journal",
  // HRM & Employment
  "Human Resource Management Journal",
  "Personnel Psychology",
  // Information Systems
  "Information Systems Research",
  "Journal of the Association for Information Systems",
  "MIS Quarterly",
  // Innovation
  "Research Policy",
  // International Business
  "Journal of International Business Studies",
  // Marketing
  "Journal of Consumer Psychology",
  "Journal of Consumer Research",
  "Journal of Marketing",
  "Journal of Marketing Research",
  "Journal of the Academy of Marketing Science",
  "Marketing Science",
  // Operations & Technology
  "Journal of Operations Management",
  "Management Science",
  "Operations Research",
  // Organizational Behavior / Psychology
  "Journal of Applied Psychology",
  "Organization Science",
  "Organizational Behavior and Human Decision Processes",
  "Psychological Science",
  // Public Administration
  "Public Administration Review",
  // Sociology
  "American Journal of Sociology",
  "American Sociological Review",
  "Annual Review of Sociology",
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
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, "")
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

  // Empty after normalization (e.g. pure Chinese names) — no match
  if (!normalized || normalized.length < 3) return { ft50: false, utd24: false, abs4star: false };

  // Try exact match first, then careful substring match
  const matchesSet = (set: Set<string>) => {
    if (set.has(normalized)) return true;
    for (const j of set) {
      if (j.length < 5 || normalized.length < 5) continue;
      // Only match if the shorter string is at least 70% of the longer string
      // This prevents "academy of marketing science review" matching "journal of the academy of marketing science"
      const shorter = Math.min(j.length, normalized.length);
      const longer = Math.max(j.length, normalized.length);
      if (shorter / longer < 0.6) continue;
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
