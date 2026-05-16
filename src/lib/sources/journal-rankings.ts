// FT50 — Financial Times Top 50 Business Journals (2025 list)
// Source: https://ceibs.libguides.com/c.php?g=963339&p=7006421
// Verified: 2026-05-16 against CEIBS LibGuides (50 journals)
export const FT50_JOURNALS = new Set([
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
  // Finance (5)
  "Journal of Finance",
  "Journal of Financial Economics",
  "Journal of Financial and Quantitative Analysis",
  "Review of Finance",
  "Review of Financial Studies",
  // Information Systems (3)
  "Information Systems Research",
  "Journal of Management Information Systems",
  "MIS Quarterly",
  // International Business (1)
  "Journal of International Business Studies",
  // Management (7)
  "Academy of Management Annals",
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
  // Organizational Behavior / HR (4)
  "Human Resource Management",
  "Journal of Applied Psychology",
  "Organizational Behavior and Human Decision Processes",
  "Organization Science",
  // Innovation (1)
  "Research Policy",
  // Strategy (1)
  "Strategic Entrepreneurship Journal",
  // Psychology (1)
  "Psychological Science",
  // Sociology (1)
  "American Sociological Review",
  // General (2)
  "Harvard Business Review",
  "MIT Sloan Management Review",
]);

// UTD24 — UT Dallas Top 24 Business School Research Rankings Journals
// Source: https://jsom.utdallas.edu/the-utd-top-100-business-school-research-rankings/
export const UTD24_JOURNALS = new Set([
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
  // Management (5)
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
// Full list of 46 journals rated 4* (Journal of Distinction)
export const ABS4STAR_JOURNALS = new Set([
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
export function normalizeJournalName(name: string): string {
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
    normalized.add(normalizeJournalName(j));
  }
  return normalized;
}

// Common name variants returned by APIs (Semantic Scholar, OpenAlex, Google Scholar)
// Map: normalized alias → canonical normalized name (already in the sets)
const JOURNAL_ALIASES: Record<string, string> = {
  // Abbreviations
  "misq": "mis quarterly",
  "amj": "academy of management journal",
  "amr": "academy of management review",
  "smj": "strategic management journal",
  "asq": "administrative science quarterly",
  "jom": "journal of operations management",
  "jmr": "journal of marketing research",
  "jcr": "journal of consumer research",
  "jfe": "journal of financial economics",
  "rfs": "review of financial studies",
  "jf": "journal of finance",
  "jams": "journal of the academy of marketing science",
  "hbr": "harvard business review",
  "jibe": "journal of international business studies",
  // Variant spellings from APIs
  "review of financial studies the": "review of financial studies",
  "the review of financial studies": "review of financial studies",
  "the journal of finance": "journal of finance",
  "the quarterly journal of economics": "quarterly journal of economics",
  "msom": "manufacturing and service operations management",
  "mand som": "manufacturing and service operations management",
  "pom": "production and operations management",
  "obhdp": "organizational behavior and human decision processes",
  "org science": "organization science",
  "orgscience": "organization science",
  "the accounting review tar": "accounting review",
  "jae": "journal of accounting and economics",
  "jar": "journal of accounting research",
  // Common non-prefix abbreviations from Semantic Scholar / Google Scholar
  "mgmt sci": "management science",
  "mgmt science": "management science",
  "management sci": "management science",
  "j mgmt": "journal of management",
  "j mgmt studies": "journal of management studies",
  "acad mgmt j": "academy of management journal",
  "acad mgmt rev": "academy of management review",
  "acad mgmt annals": "academy of management annals",
  "admin sci q": "administrative science quarterly",
  "admin sci quarterly": "administrative science quarterly",
  "mfg and service oper mgmt": "manufacturing and service operations management",
  "j int bus stud": "journal of international business studies",
  "jibs": "journal of international business studies",
  "j oper mgmt": "journal of operations management",
  "strat mgmt j": "strategic management journal",
  "org sci": "organization science",
  "hum resour mgmt": "human resource management",
  "j consum psychol": "journal of consumer psychology",
  "j world bus": "journal of world business",
  "rev financ stud": "review of financial studies",
  "rev econ stud": "review of economic studies",
  "j polit econ": "journal of political economy",
  "j polit economy": "journal of political economy",
  "amer econ rev": "american economic review",
  "am econ rev": "american economic review",
  "am sociol rev": "american sociological review",
  "amer sociol rev": "american sociological review",
  "psychol sci": "psychological science",
  "entrep theory pract": "entrepreneurship theory and practice",
  "j bus venturing": "journal of business venturing",
  "j bus ventur": "journal of business venturing",
  "prod oper mgmt": "production and operations management",
  "prod operations mgmt": "production and operations management",
  "strat entrep j": "strategic entrepreneurship journal",
  "mit sloan mgmt rev": "mit sloan management review",
  "contemp account res": "contemporary accounting research",
  "j account econ": "journal of accounting and economics",
  "j account res": "journal of accounting research",
  "rev account stud": "review of accounting studies",
  "account org soc": "accounting organizations and society",
  "j financ quant anal": "journal of financial and quantitative analysis",
  "j mgmt inf syst": "journal of management information systems",
  "jmis": "journal of management information systems",
};

const ft50Normalized = buildNormalizedSet(FT50_JOURNALS);
const utd24Normalized = buildNormalizedSet(UTD24_JOURNALS);
const abs4starNormalized = buildNormalizedSet(ABS4STAR_JOURNALS);

/** Check if venue words are abbreviation-prefixes of journal words.
 *  e.g. "Acad Manag J" matches "academy of management journal"
 *  Skips common filler words like "of", "and", "the", "for".
 */
function abbreviationMatch(venueNorm: string, journalNorm: string): boolean {
  const fillers = new Set(["of", "and", "the", "for", "in", "on", "a", "an"]);
  const venueWords = venueNorm.split(/\s+/).filter(w => !fillers.has(w) && w.length > 0);
  const journalWords = journalNorm.split(/\s+/).filter(w => !fillers.has(w) && w.length > 0);
  if (venueWords.length < 2 || journalWords.length < 2) return false;
  if (venueWords.length !== journalWords.length) return false;
  return venueWords.every((vw, i) =>
    journalWords[i].startsWith(vw) || vw.startsWith(journalWords[i])
  );
}

export function getJournalRanking(venue: string | undefined | null): JournalRanking {
  if (!venue) return { ft50: false, utd24: false, abs4star: false };

  const normalized = normalizeJournalName(venue);

  // Empty after normalization (e.g. pure Chinese names) — no match
  if (!normalized || normalized.length < 3) return { ft50: false, utd24: false, abs4star: false };

  // Resolve alias if exists
  const resolved = JOURNAL_ALIASES[normalized] ?? normalized;

  // Primary: exact match or known alias
  const exactMatch = (set: Set<string>) => set.has(resolved);

  // Fallback: abbreviation-prefix matching for API venue names like
  // "Acad Manag J" → "academy of management journal"
  // "J Financ Econ" → "journal of financial economics"
  const abbrMatch = (set: Set<string>) => {
    for (const j of set) {
      if (abbreviationMatch(resolved, j)) return true;
    }
    return false;
  };

  const matchesSet = (set: Set<string>) => exactMatch(set) || abbrMatch(set);

  return {
    ft50: matchesSet(ft50Normalized),
    utd24: matchesSet(utd24Normalized),
    abs4star: matchesSet(abs4starNormalized),
  };
}
