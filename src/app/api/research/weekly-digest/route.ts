/**
 * Weekly AI Research Digest — auto-collects newly published AI-related papers
 * from top journals (ABS 3+, Nature/Science family) and arXiv.
 *
 * Triggered:
 *  - Manually via POST from UI
 *  - Automatically via cron (GET with secret)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callAI, setAIContext } from "@/lib/ai";
import { requireProjectAccess } from "@/lib/auth";
import { searchArxiv } from "@/lib/sources/arxiv";
import { searchGoogleScholar } from "@/lib/sources/google-scholar";
import type { UnifiedPaper } from "@/lib/sources/types";

// ─── OpenAlex Source IDs for target journals ──────
// Using source IDs (not name search) for reliable filtering
const TARGET_SOURCES = {
  // Nature / Science family
  "S137773608": "Nature",
  "S3880285": "Science",
  "S2912241403": "Nature Machine Intelligence",
  "S4210228084": "Nature Computational Science",
  "S2764866340": "Nature Human Behaviour",
  "S64187185": "Nature Communications",
  "S4210239724": "Nature Electronics",
  "S2737427234": "Science Advances",
  "S4210213233": "Science Robotics",
  // Top management / IS journals (ABS 4* and 4)
  "S33323087": "Management Science",
  "S57293258": "MIS Quarterly",
  "S202812398": "Information Systems Research",
  "S117778295": "Academy of Management Journal",
  "S24092667": "Academy of Management Review",
  "S206124708": "Organization Science",
  "S102949365": "Strategic Management Journal",
  "S91740795": "Journal of Management",
  "S142990027": "Journal of Marketing",
  "S182017137": "Journal of Applied Psychology",
  "S150700104": "Journal of Business Ethics",
  "S68862796": "Research Policy",
  "S56749031": "Journal of Management Studies",
  "S2735964968": "Journal of the Academy of Marketing Science",
  "S197444251": "Journal of International Business Studies",
  "S45984537": "Journal of Operations Management",
  "S194828483": "Journal of Business Research",
  // ABS 3 IS journals
  "S75074749": "Information Systems Frontiers",
  "S130564218": "Decision Support Systems",
  "S143948427": "Electronic Commerce Research and Applications",
  "S4210175918": "Internet Research",
};

const AI_KEYWORDS = [
  "artificial intelligence",
  "machine learning",
  "deep learning",
  "large language model",
  "generative AI",
  "algorithm",
  "neural network",
  "natural language processing",
  "AI",
  "ChatGPT",
  "GPT",
  "transformer model",
  "reinforcement learning",
  "computer vision",
  "AI agent",
  "foundation model",
  "multimodal",
  "prompt engineering",
  "retrieval augmented generation",
];

// ─── OpenAlex: search by source ID ────────────────
async function fetchFromOpenAlex(daysBack: number): Promise<UnifiedPaper[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().split("T")[0];

  const allPapers: UnifiedPaper[] = [];
  const sourceIds = Object.keys(TARGET_SOURCES);

  // Batch source IDs into groups (OpenAlex supports OR via pipe)
  const BATCH_SIZE = 10;
  const batches: string[][] = [];
  for (let i = 0; i < sourceIds.length; i += BATCH_SIZE) {
    batches.push(sourceIds.slice(i, i + BATCH_SIZE));
  }

  // Search each batch in parallel
  await Promise.all(
    batches.map(async (batchIds) => {
      const sourceFilter = batchIds.join("|");
      for (const keyword of AI_KEYWORDS.slice(0, 5)) {
        try {
          const params = new URLSearchParams({
            search: keyword,
            per_page: "25",
            filter: `from_publication_date:${sinceStr},type:article,primary_location.source.id:${sourceFilter}`,
            sort: "publication_date:desc",
            select: "id,doi,display_name,title,publication_year,cited_by_count,authorships,primary_location,abstract_inverted_index,open_access",
          });
          if (process.env.OPENALEX_EMAIL) params.set("mailto", process.env.OPENALEX_EMAIL);

          const res = await fetch(`https://api.openalex.org/works?${params}`, {
            signal: AbortSignal.timeout(12000),
          });
          if (!res.ok) continue;
          const data = await res.json();

          for (const w of data.results ?? []) {
            const venue = w.primary_location?.source?.display_name ?? "";
            const paper = mapOpenAlexPaper(w, venue);
            if (paper) allPapers.push(paper);
          }
        } catch { /* skip */ }
      }
    })
  );

  return allPapers;
}

// Also do a broad AI search in ANY journal (catch ABS 3 journals not in our ID list)
async function fetchBroadAI(daysBack: number): Promise<UnifiedPaper[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().split("T")[0];

  const papers: UnifiedPaper[] = [];

  try {
    const params = new URLSearchParams({
      search: "artificial intelligence OR machine learning OR large language model",
      per_page: "30",
      filter: `from_publication_date:${sinceStr},type:article,primary_location.source.type:journal,cited_by_count:>0`,
      sort: "cited_by_count:desc",
      select: "id,doi,display_name,title,publication_year,cited_by_count,authorships,primary_location,abstract_inverted_index,open_access",
    });
    if (process.env.OPENALEX_EMAIL) params.set("mailto", process.env.OPENALEX_EMAIL);

    const res = await fetch(`https://api.openalex.org/works?${params}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = await res.json();
      for (const w of data.results ?? []) {
        const venue = w.primary_location?.source?.display_name ?? "";
        const paper = mapOpenAlexPaper(w, venue);
        if (paper) papers.push(paper);
      }
    }
  } catch { /* skip */ }

  return papers;
}

function mapOpenAlexPaper(w: Record<string, unknown>, venue: string): UnifiedPaper | null {
  const title = (w.display_name ?? w.title) as string;
  if (!title) return null;

  let abstract: string | undefined;
  const invIdx = w.abstract_inverted_index as Record<string, number[]> | null;
  if (invIdx) {
    const words: string[] = [];
    for (const [word, positions] of Object.entries(invIdx)) {
      for (const pos of positions) words[pos] = word;
    }
    abstract = words.join(" ").trim();
  }

  const authorships = (w.authorships ?? []) as Array<{ author: { display_name: string } }>;
  const doi = (w.doi as string | undefined)?.replace("https://doi.org/", "");
  const oa = w.open_access as { oa_url?: string } | undefined;

  return {
    title,
    abstract,
    authors: authorships.slice(0, 10).map((a) => ({ name: a.author.display_name })),
    year: w.publication_year as number | undefined,
    venue,
    citationCount: (w.cited_by_count as number) ?? 0,
    referenceCount: 0,
    doi,
    externalId: (w.id as string)?.replace("https://openalex.org/", ""),
    source: "openalex",
    openAccessPdf: oa?.oa_url,
  };
}

// ─── arXiv: AI preprints ──────────────────────────
async function fetchArxivAI(daysBack: number): Promise<UnifiedPaper[]> {
  const queries = [
    "artificial intelligence management",
    "large language model organization",
    "AI corporate governance",
    "machine learning business",
    "generative AI firm",
    "algorithmic decision making",
  ];

  const results: UnifiedPaper[] = [];
  await Promise.all(
    queries.slice(0, 4).map(async (q) => {
      try {
        const r = await searchArxiv({ query: q, limit: 10 });
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysBack);
        for (const p of r.papers) {
          if ((p.year ?? 0) >= cutoff.getFullYear()) results.push(p);
        }
      } catch { /* skip */ }
    })
  );
  return results;
}

// ─── Google Scholar: single Serper call ─────────────
async function fetchGoogleScholarAI(): Promise<UnifiedPaper[]> {
  try {
    // One combined query to minimize Serper API calls (costs exactly 1 call)
    const thisYear = new Date().getFullYear();
    const result = await searchGoogleScholar({
      query: "artificial intelligence OR large language model OR generative AI management organization",
      limit: 10, // limit <= 20 ensures only 1 Serper page is fetched
      yearFrom: thisYear,
      yearTo: thisYear,
    });
    console.log(`[weekly-digest] Google Scholar returned ${result.papers.length} papers`);
    return result.papers;
  } catch (err) {
    console.error("[weekly-digest] Google Scholar failed:", (err as Error).message);
    return [];
  }
}

// ─── Batch AI Analysis ──────────────────────────────
async function batchAnalyzePapers(paperIds: string[]) {
  // Load papers from DB
  const papers = await prisma.paper.findMany({
    where: { id: { in: paperIds }, aiAnalysis: null },
    select: { id: true, title: true, abstract: true, authors: true, year: true, venue: true, citationCount: true, doi: true },
  });

  if (papers.length === 0) return;

  // Also try to fill incomplete abstracts from OpenAlex
  // Detect snippets: short text, contains "...", or starts/ends with "..."
  const incompleteAbstractPapers = papers.filter(
    (p) => !p.abstract || p.abstract.length < 200 || p.abstract.includes("...") || p.abstract.includes("\u2026")
  );
  if (incompleteAbstractPapers.length > 0) {
    await Promise.all(
      incompleteAbstractPapers.map(async (p) => {
        try {
          let url: string;
          if (p.doi) {
            url = `https://api.openalex.org/works/doi:${p.doi}?select=abstract_inverted_index`;
          } else {
            const params = new URLSearchParams({ search: p.title, per_page: "1", select: "abstract_inverted_index,display_name" });
            url = `https://api.openalex.org/works?${params}`;
          }
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) return;
          const data = await res.json();
          const work = p.doi ? data : data.results?.[0];
          const invIdx = work?.abstract_inverted_index;
          if (!invIdx) return;
          const words: string[] = [];
          for (const [word, positions] of Object.entries(invIdx)) {
            for (const pos of positions as number[]) words[pos] = word;
          }
          const full = words.join(" ").trim();
          if (full.length > 50) {
            p.abstract = full;
            await prisma.paper.update({ where: { id: p.id }, data: { abstract: full } });
          }
        } catch { /* skip */ }
      })
    );
  }

  // Batch into groups of 10, run ALL batches in parallel
  const BATCH = 10;
  const batches: typeof papers[] = [];
  for (let i = 0; i < papers.length; i += BATCH) {
    batches.push(papers.slice(i, i + BATCH));
  }

  await Promise.all(
    batches.map(async (batch) => {
      const paperList = batch.map((p, idx) => {
        const authors = (p.authors as Array<{ name: string }>)?.slice(0, 3).map((a) => a.name).join(", ") ?? "";
        return `[${idx + 1}] 标题: ${p.title}\n作者: ${authors}\n年份: ${p.year ?? "N/A"} | 期刊: ${p.venue ?? "N/A"} | 引用: ${p.citationCount}\n摘要: ${p.abstract ?? "无摘要"}`;
      }).join("\n\n---\n\n");

      try {
        const result = await callAI({
          provider: "gemini",
          messages: [{
            role: "user",
            content: `Perform structured analysis on the following ${batch.length} papers.\n\n${paperList}\n\nReturn strict JSON array (no markdown). Each element corresponds to one paper:\n[{"tags":["tag1","tag2","tag3"],"model":"theoretical model (1-2 sentences)","variables":"key variables (IV, DV, mediator, moderator)","method":"research method (1-2 sentences)","contribution":"marginal contribution (1-2 sentences)"}]`,
          }],
          system: "You are a management research methodology expert. For each paper, extract 3-5 key tags (theory names, method types, research domains) and analyze its theoretical model, key variables, research methods, and marginal contribution. Respond in Chinese. Return JSON array only, no other text.",
          temperature: 0.1,
          maxTokens: 4000,
        });

        // Parse JSON response
        let analyses: Array<{ tags?: string[]; model?: string; variables?: string; method?: string; contribution?: string }> = [];
        try {
          const cleaned = result.content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          analyses = JSON.parse(cleaned);
        } catch {
          console.error("[weekly-digest] Failed to parse batch AI analysis");
          return;
        }

        // Save analysis to each paper
        await Promise.all(
          batch.map(async (p, idx) => {
            const a = analyses[idx];
            if (!a) return;
            try {
              await prisma.paper.update({
                where: { id: p.id },
                data: { aiAnalysis: JSON.stringify(a) },
              });
            } catch { /* skip */ }
          })
        );
      } catch (err) {
        console.error("[weekly-digest] Batch analysis error:", (err as Error).message);
      }
    })
  );
}

// ─── Dedup ─────────────────────────────────────────
function dedupByTitle(papers: UnifiedPaper[]): UnifiedPaper[] {
  const seen = new Map<string, UnifiedPaper>();
  for (const p of papers) {
    const key = p.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    if (!seen.has(key) || (p.abstract && !seen.get(key)!.abstract)) {
      seen.set(key, p);
    }
  }
  return Array.from(seen.values());
}

// ─── Handlers ──────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await prisma.researchProject.findMany({ select: { id: true } });
  let totalSaved = 0;
  for (const project of projects) {
    const result = await runDigest(project.id);
    totalSaved += result.saved;
  }

  return NextResponse.json({ ok: true, projects: projects.length, totalSaved });
}

export async function POST(request: Request) {
  try {
    const { projectId, daysBack = 30 } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;
    setAIContext(auth.id, "/api/research/weekly-digest");

    const result = await runDigest(projectId, daysBack);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Digest failed", details: String(error) },
      { status: 500 }
    );
  }
}

async function runDigest(projectId: string, daysBack: number = 30) {
  const weekLabel = getWeekLabel();
  const folderName = `AI 前沿周刊 ${weekLabel}`;

  // Delete old papers in this week's folder so each click fetches fresh results
  await prisma.paper.deleteMany({
    where: { projectId, folder: folderName },
  });

  // Fetch from all sources IN PARALLEL
  console.log(`[weekly-digest] Fetching papers from last ${daysBack} days...`);
  const [targetPapers, broadPapers, arxivPapers, scholarPapers] = await Promise.all([
    fetchFromOpenAlex(daysBack),
    fetchBroadAI(daysBack),
    fetchArxivAI(daysBack),
    fetchGoogleScholarAI(),
  ]);

  console.log(`[weekly-digest] Found: ${targetPapers.length} target, ${broadPapers.length} broad, ${arxivPapers.length} arXiv, ${scholarPapers.length} scholar`);

  // Strict year filter: only keep papers from current year or last year (to handle year boundary)
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 1;

  const allPapers = dedupByTitle([...targetPapers, ...broadPapers, ...arxivPapers, ...scholarPapers])
    .filter((p) => !p.year || p.year >= minYear);
  console.log(`[weekly-digest] After dedup + year filter (>=${minYear}): ${allPapers.length}`);

  // Save to database
  let saved = 0;
  const savedIds: string[] = [];
  for (const paper of allPapers.slice(0, 80)) {
    try {
      const created = await prisma.paper.create({
        data: {
          projectId,
          title: paper.title,
          abstract: paper.abstract,
          authors: JSON.parse(JSON.stringify(paper.authors ?? [])),
          year: paper.year,
          venue: paper.venue,
          citationCount: paper.citationCount,
          doi: paper.doi,
          externalId: paper.externalId,
          source: paper.source,
          openAccessPdf: paper.openAccessPdf,
          pdfUrl: paper.openAccessPdf,
          folder: folderName,
          isSelected: false,
        },
      });
      saved++;
      savedIds.push(created.id);
    } catch {
      // Skip duplicates
    }
  }

  return {
    saved,
    savedIds,
    total: allPapers.length,
    folder: folderName,
    sources: {
      targetJournals: targetPapers.length,
      broadSearch: broadPapers.length,
      arxiv: arxivPapers.length,
      googleScholar: scholarPapers.length,
    },
  };
}

function getWeekLabel(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export const maxDuration = 300;
