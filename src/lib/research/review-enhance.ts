/**
 * Review Enhancement pipeline: analyze draft → find gaps → plan revisions → rewrite.
 */

import { callAI, streamAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";

// ─── Types ───────────────────────────────────────

export interface DraftAnalysis {
  topic: string;
  keyThemes: string[];
  citedReferences: string[];
  structureOutline: { heading: string; summary: string; citationCount: number }[];
  keywords: string[];
  weakSections: string[];
  libraryMatchCount: number;
}

export interface GapPaper {
  title: string;
  authors: string;
  year: number;
  venue: string;
  abstract: string;
  relevanceReason: string;
  suggestedSection: string;
  aiAnalysis?: string;
  citationCount?: number;
  doi?: string;
  relevanceScore?: number;
  journalRanking?: { badges?: string[]; utd24?: boolean; ft50?: boolean };
  journalMeta?: { jcrQuartile?: string; absRating?: string; impactFactor?: number; ssci?: boolean; sci?: boolean };
}

export interface TopicGroup {
  topic: string;
  description: string;
  papers: (GapPaper & { aiAnalysis?: string })[];
}

export interface CoverageGap {
  theme: string;
  description: string;
  severity: "high" | "medium" | "low";
  papers: (GapPaper & { aiAnalysis?: string })[];
}

export interface WeakSection {
  heading: string;
  issue: string;
  suggestion: string;
}

export interface GapAnalysis {
  coverageGaps: CoverageGap[];
  weakSections: WeakSection[];
  libraryUnused: string[];
  // Legacy
  topicGroups?: TopicGroup[];
  newPapers: GapPaper[];
}

export interface RevisionItem {
  heading: string;
  description: string;
  papersToAdd: string[];
  priority: "high" | "medium" | "low";
}

export interface RevisionPlan {
  improve: RevisionItem[];
  extend: RevisionItem[];
  overallStrategy: string;
  estimatedChanges: string;
  // Legacy compat
  sections?: { action: string; heading: string; description: string; papersToAdd: string[]; priority: string }[];
}

export type EnhancePhase =
  | "idle" | "uploading" | "analyzing" | "searching" | "gap-analysis"
  | "planning" | "user-review" | "rewriting" | "done";

export interface LibraryPaper {
  id: string;
  title: string;
  abstract?: string | null;
  authors: { name: string }[] | string;
  year?: number | null;
  venue?: string | null;
  fullText?: string | null;
}

// ─── Phase 1: Analyze Draft ──────────────────────

const ANALYZE_DRAFT_PROMPT = `You are an academic literature review analysis expert. Given the full text of a draft literature review AND a list of papers from the user's library, extract the following information:

1. **topic**: The main research topic/theme of the review (1-2 sentences, in Chinese)
2. **keyThemes**: 3-8 major themes/subtopics covered in the review (Chinese)
3. **citedReferences**: Extract all cited paper titles/authors from the reference list. Include as many as you can identify. Use the format "Author (Year). Title"
4. **structureOutline**: The current section headings with a brief summary and approximate citation count per section
5. **keywords**: 5-10 academic search keywords that capture the review's scope (in ENGLISH, for searching international databases)
6. **weakSections**: Sections that appear thin, lack sufficient citations, or have argumentation gaps (Chinese descriptions)
7. **libraryMatchCount**: How many of the user's library papers are cited or closely match references in the draft

Output strict JSON:
{
  "topic": "...",
  "keyThemes": ["..."],
  "citedReferences": ["Author (Year). Title", ...],
  "structureOutline": [{"heading": "...", "summary": "...", "citationCount": 0}],
  "keywords": ["...", "..."],
  "weakSections": ["..."],
  "libraryMatchCount": 0
}`;

export async function analyzeDraft(
  draftText: string,
  libraryPapers: LibraryPaper[],
  provider: AIProvider,
): Promise<DraftAnalysis> {
  const libraryContext = libraryPapers.slice(0, 50).map((p, i) => {
    const authors = typeof p.authors === "string" ? p.authors : (p.authors ?? []).slice(0, 3).map(a => a.name).join(", ");
    return `[Lib-${i + 1}] ${p.title} (${p.year ?? "?"}) — ${authors}${p.abstract ? `\nAbstract: ${p.abstract.slice(0, 200)}` : ""}`;
  }).join("\n\n");

  const response = await callAI({
    provider,
    system: ANALYZE_DRAFT_PROMPT,
    messages: [{
      role: "user",
      content: `## Draft Literature Review (${draftText.length} chars):\n\n${draftText.slice(0, 15000)}\n\n## User's Paper Library (${libraryPapers.length} papers):\n\n${libraryContext}`,
    }],
    jsonMode: true,
    noThinking: true,
    temperature: 0.2,
    maxTokens: 4096,
  });

  return JSON.parse(response.content);
}

// ─── Phase 2: Gap Analysis ───────────────────────

const GAP_ANALYSIS_PROMPT = `You are a literature review gap analysis expert. You are given:
1. A draft literature review's analysis (topic, themes, cited references, structure)
2. A list of newly discovered papers with AI analysis from academic database search
3. A list of papers in the user's library

Your task: Identify coverage gaps in the draft, and for EACH gap, recommend specific papers that can fill it.

IMPORTANT: Each coverage gap MUST have associated papers. Papers are organized UNDER the gap they address — this helps the user understand WHY each paper is recommended.

Output strict JSON:
{
  "coverageGaps": [{
    "theme": "缺口主题（中文）",
    "description": "详细描述该缺口——初稿缺少什么、为什么重要（中文，2-3句）",
    "severity": "high|medium|low",
    "paperIndices": [0, 3, 7]
  }],
  "weakSections": [{
    "heading": "章节标题",
    "issue": "具体问题描述（中文）",
    "suggestion": "改进建议（中文，2-3句，具体可操作）"
  }],
  "libraryUnused": ["文献库中有但初稿未引用的相关论文标题"]
}

Rules:
- coverageGaps: identify 4-8 coverage gaps. Each gap has paperIndices (0-based into Newly Found Papers list)
- Each paper can appear in multiple gaps if relevant
- Include ALL relevant papers — do NOT limit to 15
- weakSections: suggest 3-6 specific improvements to existing sections (structure, depth, argumentation)
- libraryUnused: only list library papers that ARE relevant but NOT cited
- All descriptions in Chinese
- severity: "high" = critical gap that significantly weakens the review, "medium" = important improvement, "low" = nice to have`;

export async function analyzeGaps(
  draftAnalysis: DraftAnalysis,
  searchPapers: { title: string; authors: string; year: number; venue: string; abstract: string; aiAnalysis?: string }[],
  libraryPapers: LibraryPaper[],
  provider: AIProvider,
): Promise<GapAnalysis> {
  const draftContext = `Topic: ${draftAnalysis.topic}\nThemes: ${draftAnalysis.keyThemes.join(", ")}\nCited references (${draftAnalysis.citedReferences.length}):\n${draftAnalysis.citedReferences.slice(0, 30).join("\n")}\nStructure:\n${draftAnalysis.structureOutline.map(s => `- ${s.heading} (${s.citationCount} citations): ${s.summary}`).join("\n")}\nWeak sections: ${draftAnalysis.weakSections.join("; ")}`;

  const searchContext = searchPapers.map((p, i) =>
    `[${i}] ${p.title} (${p.year}) — ${p.authors} | ${p.venue}${p.aiAnalysis ? `\nAI分析: ${p.aiAnalysis.slice(0, 150)}` : `\n摘要: ${(p.abstract ?? "").slice(0, 150)}`}`
  ).join("\n");

  const libraryContext = libraryPapers.slice(0, 20).map((p, i) => {
    const authors = typeof p.authors === "string" ? p.authors : (p.authors ?? []).map(a => a.name).join(", ");
    return `[Lib-${i + 1}] ${p.title} (${p.year ?? "?"}) — ${authors}`;
  }).join("\n");

  const response = await callAI({
    provider,
    system: GAP_ANALYSIS_PROMPT,
    messages: [{
      role: "user",
      content: `## Draft Analysis:\n${draftContext}\n\n## Newly Found Papers (${searchPapers.length}):\n${searchContext}\n\n## User Library Papers (${libraryPapers.length}):\n${libraryContext}`,
    }],
    jsonMode: true,
    noThinking: true,
    temperature: 0.2,
    maxTokens: 4096,
  });

  const raw = JSON.parse(response.content);

  // Build coverage gaps with full paper data
  const coverageGaps: CoverageGap[] = (raw.coverageGaps ?? []).map((gap: { theme: string; description: string; severity: string; paperIndices?: number[] }) => ({
    theme: gap.theme,
    description: gap.description,
    severity: gap.severity as CoverageGap["severity"],
    papers: (gap.paperIndices ?? [])
      .filter((i: number) => i >= 0 && i < searchPapers.length)
      .map((i: number) => {
        const p = searchPapers[i] as Record<string, unknown>;
        return {
          title: p.title as string,
          authors: p.authors as string,
          year: p.year as number,
          venue: p.venue as string,
          abstract: p.abstract as string,
          relevanceReason: "",
          suggestedSection: gap.theme,
          aiAnalysis: p.aiAnalysis as string | undefined,
          citationCount: p.citationCount as number | undefined,
          doi: p.doi as string | undefined,
          relevanceScore: p.relevanceScore as number | undefined,
          journalRanking: p.journalRanking as GapPaper["journalRanking"],
          journalMeta: p.journalMeta as GapPaper["journalMeta"],
        };
      }),
  }));

  // Flat list for backward compat
  const allPapers = coverageGaps.flatMap(g => g.papers);
  const seen = new Set<string>();
  const newPapers = allPapers.filter(p => {
    if (seen.has(p.title)) return false;
    seen.add(p.title);
    return true;
  });

  return {
    coverageGaps,
    newPapers,
    weakSections: raw.weakSections ?? [],
    libraryUnused: raw.libraryUnused ?? [],
  };
}

// ─── Phase 3: Revision Plan ──────────────────────

const REVISION_PLAN_PROMPT = `You are a literature review revision planning expert. Based on the draft analysis, coverage gaps, and user-selected improvement suggestions, create a structured revision plan with TWO categories:

## Category 1: 已有内容改进 (improve)
Optimize, deepen, and supplement content that ALREADY EXISTS in the draft:
- Strengthen weak arguments with better evidence or counterarguments
- Deepen theoretical analysis (mechanisms, boundary conditions, contradictions)
- Expand existing sections with more citations and richer discussion
- Improve logical flow, restructure paragraphs
- Fix factual or citation issues

## Category 2: 方向扩展延伸 (extend)
Propose NEW sub-directions that the draft does NOT cover:
- New research perspectives or cross-disciplinary angles
- Emerging trends not mentioned in the draft
- New subsections or topics that would make the review more comprehensive
- Contrarian or critical viewpoints missing from the draft

For EACH item, you MUST specify which papers from the available papers list should be incorporated. Use exact paper titles.

Output strict JSON:
{
  "improve": [{
    "heading": "对应的初稿章节标题（中文）",
    "description": "具体改进内容（中文，2-3句：改什么、为什么、怎么改）",
    "papersToAdd": ["Exact Paper Title 1", "Exact Paper Title 2"],
    "priority": "high|medium|low"
  }],
  "extend": [{
    "heading": "新方向标题（中文）",
    "description": "该方向的内容说明（中文，2-3句：是什么、为什么重要、如何展开）",
    "papersToAdd": ["Exact Paper Title 1"],
    "priority": "high|medium|low"
  }],
  "overallStrategy": "整体修改策略描述（中文，2-3句）",
  "estimatedChanges": "改进X处、新增方向Y个、涉及文献N篇"
}

IMPORTANT:
- "improve" items: MUST reference existing sections/headings from the draft
- "extend" items: MUST be genuinely NEW directions not in the draft
- Each item MUST have at least 1 paper in papersToAdd (use exact titles from Available Papers)
- Generate 3-6 "improve" items and 2-4 "extend" items`;

export async function generateRevisionPlan(
  draftText: string,
  draftAnalysis: DraftAnalysis,
  gapAnalysis: GapAnalysis,
  libraryPapers: LibraryPaper[],
  provider: AIProvider,
  stormContext?: string,
): Promise<RevisionPlan> {
  const gapContext = `Coverage Gaps:\n${gapAnalysis.coverageGaps.map(g => `- [${g.severity}] ${g.theme}: ${g.description}`).join("\n")}\n\nWeak Sections:\n${gapAnalysis.weakSections.map(w => `- ${w.heading}: ${w.issue} → ${w.suggestion}`).join("\n")}\n\nRecommended New Papers:\n${gapAnalysis.newPapers.map(p => `- ${p.title} (${p.year}) → ${p.suggestedSection}: ${p.relevanceReason}`).join("\n")}\n\nUnused Library Papers:\n${gapAnalysis.libraryUnused.map(t => `- ${t}`).join("\n")}`;

  const userContent = `## Draft Structure:\n${draftAnalysis.structureOutline.map(s => `### ${s.heading}\n${s.summary}\nCitations: ${s.citationCount}`).join("\n\n")}\n\n## Gap Analysis:\n${gapContext}${stormContext ? `\n\n## STORM Deep Analysis:\n${stormContext}` : ""}`;

  const response = await callAI({
    provider,
    system: REVISION_PLAN_PROMPT,
    messages: [{ role: "user", content: userContent }],
    jsonMode: true,
    noThinking: true,
    temperature: 0.3,
    maxTokens: 4096,
  });

  return JSON.parse(response.content);
}

// ─── Phase 4: Rewrite ────────────────────────────

const REWRITE_PROMPT = `You are a literature review writing expert. You are given:
1. The original draft review text
2. A revision plan with specific changes approved by the user
3. Papers to incorporate (with abstracts and optional full text)

Rewrite the literature review according to the revision plan. Rules:
- Preserve the original text's good parts — do not unnecessarily rewrite what already works well
- CITATION FORMAT: Use standard in-text APA citations throughout: (Author, Year) or Author (Year)
  Examples: (Smith & Jones, 2023), Zhang et al. (2024), (Brown, 2022; Lee & Park, 2023)
  NEVER use internal labels like [New-1], [Lib-3], (New-1;New-9) — always convert to proper APA format using the author names and year provided in the paper data
- Mark IMPROVED content with 【改进】 at the beginning of modified paragraphs
- Mark NEW DIRECTION content with 【新方向】 at the beginning of new sections
- Write in academic Chinese (学术中文), clear paragraphs
- Each claim must have a citation in APA format
- Maintain logical flow between sections
- Use markdown headings (## for main sections, ### for subsections)
- Include a complete updated reference list at the end (## 参考文献) in full APA format:
  Author, A. A., & Author, B. B. (Year). Title. Journal, Volume(Issue), Pages. https://doi.org/xxx`;

export async function* rewriteReviewStream(
  draftText: string,
  revisionPlan: RevisionPlan,
  libraryPapers: LibraryPaper[],
  searchPapers: { title: string; authors: string; year: number; venue: string; abstract: string }[],
  provider: AIProvider,
  wordCount?: { min: number; max: number },
): AsyncGenerator<string> {
  const improveContext = (revisionPlan.improve ?? [])
    .map(s => `[已有内容改进] ${s.heading}: ${s.description}\nPapers: ${s.papersToAdd.join("; ")}`)
    .join("\n\n");
  const extendContext = (revisionPlan.extend ?? [])
    .map(s => `[方向扩展延伸] ${s.heading}: ${s.description}\nPapers: ${s.papersToAdd.join("; ")}`)
    .join("\n\n");
  const planContext = [improveContext, extendContext].filter(Boolean).join("\n\n" + "=".repeat(30) + "\n\n");
  // Legacy fallback
  if (!planContext && revisionPlan.sections) {
    const legacy = revisionPlan.sections.filter(s => s.action !== "keep")
      .map(s => `[${s.action}] ${s.heading}: ${s.description}\nPapers: ${s.papersToAdd.join("; ")}`)
      .join("\n\n");
    if (legacy) { /* use legacy below */ }
  }

  // Format papers with author names front and center (for APA citations)
  const papersContext = [
    ...libraryPapers.slice(0, 20).map((p) => {
      const authors = typeof p.authors === "string" ? p.authors : (p.authors ?? []).map(a => a.name).join(", ");
      return `Authors: ${authors}\nYear: ${p.year ?? "?"}\nTitle: ${p.title}\nVenue: ${p.venue ?? ""}\n${p.fullText ? `Full text:\n${p.fullText.slice(0, 5000)}` : `Abstract: ${p.abstract ?? "N/A"}`}`;
    }),
    ...searchPapers.slice(0, 15).map((p) =>
      `Authors: ${p.authors}\nYear: ${p.year}\nTitle: ${p.title}\nVenue: ${p.venue}\nAbstract: ${p.abstract?.slice(0, 500) ?? "N/A"}`
    ),
  ].join("\n\n" + "─".repeat(40) + "\n\n");

  const stream = streamAI({
    provider,
    messages: [
      { role: "system", content: REWRITE_PROMPT },
      {
        role: "user",
        content: `## Target Word Count: ${wordCount ? `${wordCount.min}-${wordCount.max}` : "8000-12000"}字\n\n## Overall Strategy:\n${revisionPlan.overallStrategy}\n\n## Revision Plan:\n${planContext}\n\n## Original Draft:\n${draftText.slice(0, 12000)}\n\n## Available Papers:\n${papersContext}`,
      },
    ],
    temperature: 0.4,
    maxTokens: wordCount ? Math.max(8192, Math.ceil(wordCount.max * 1.5)) : 8192,
  });

  for await (const chunk of stream) {
    yield chunk;
  }
}

// ─── Integrate New Papers ────────────────────────

const INTEGRATE_PROMPT = `You are a literature review integration expert. The user has uploaded additional papers to integrate into an existing enhanced review.

Analyze ONLY the new papers provided. For each:
1. Determine where in the existing review it is most relevant
2. Weave the new citations naturally into existing paragraphs or add new paragraphs where needed

Output the FULL updated review with new papers integrated. Mark all additions with 【新增引用】.
Write in academic Chinese. Use APA citation format. Use markdown headings.`;

export async function* integratePapersStream(
  existingReview: string,
  newPapers: LibraryPaper[],
  provider: AIProvider,
): AsyncGenerator<string> {
  const papersContext = newPapers.map((p, i) => {
    const authors = typeof p.authors === "string" ? p.authors : (p.authors ?? []).map(a => a.name).join(", ");
    return `[${i + 1}] ${p.title} (${p.year ?? "?"}) — ${authors}\n${p.fullText ? p.fullText.slice(0, 5000) : (p.abstract ?? "")}`;
  }).join("\n\n");

  const stream = streamAI({
    provider,
    messages: [
      { role: "system", content: INTEGRATE_PROMPT },
      {
        role: "user",
        content: `## Current Review:\n${existingReview.slice(0, 12000)}\n\n## New Papers to Integrate (${newPapers.length}):\n${papersContext}`,
      },
    ],
    temperature: 0.4,
    maxTokens: 8192,
  });

  for await (const chunk of stream) {
    yield chunk;
  }
}
