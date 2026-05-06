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

export interface GapAnalysis {
  topicGroups: TopicGroup[];
  coverageGaps: { theme: string; description: string; severity: "high" | "medium" | "low" }[];
  weakSections: { heading: string; issue: string; suggestion: string }[];
  libraryUnused: string[];
  // Legacy flat list for backward compat
  newPapers: GapPaper[];
}

export interface RevisionPlan {
  sections: {
    action: "add" | "expand" | "restructure" | "keep";
    heading: string;
    description: string;
    papersToAdd: string[];
    priority: "high" | "medium" | "low";
  }[];
  overallStrategy: string;
  estimatedChanges: string;
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

Your task: Group the found papers by research topic, identify gaps, and recommend improvements.

IMPORTANT: Include ALL relevant papers, grouped by topic. Do NOT limit to 15 — include as many as are relevant.

Output strict JSON:
{
  "topicGroups": [{
    "topic": "话题名称（中文）",
    "description": "该话题与综述的关联说明（中文，1-2句）",
    "paperIndices": [0, 3, 7]
  }],
  "coverageGaps": [{
    "theme": "缺失的主题（中文）",
    "description": "详细描述该gap（中文）",
    "severity": "high|medium|low"
  }],
  "weakSections": [{
    "heading": "章节标题",
    "issue": "问题描述（中文）",
    "suggestion": "改进建议（中文）"
  }],
  "libraryUnused": ["文献库中有但初稿未引用的相关论文标题"]
}

Rules:
- topicGroups.paperIndices: indices into the Newly Found Papers list (0-based)
- Group papers into 3-8 topics based on research themes
- Each paper can appear in multiple topic groups if relevant
- Include ALL papers that are relevant to the draft (no cap)
- libraryUnused: only list library papers that ARE relevant but NOT cited
- All descriptions in Chinese`;

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

  // Build topic groups with full paper data
  const topicGroups: TopicGroup[] = (raw.topicGroups ?? []).map((tg: { topic: string; description: string; paperIndices: number[] }) => ({
    topic: tg.topic,
    description: tg.description,
    papers: (tg.paperIndices ?? [])
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
          suggestedSection: tg.topic,
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
  const allPapers = topicGroups.flatMap(tg => tg.papers);
  const seen = new Set<string>();
  const newPapers = allPapers.filter(p => {
    if (seen.has(p.title)) return false;
    seen.add(p.title);
    return true;
  });

  return {
    topicGroups,
    newPapers,
    coverageGaps: raw.coverageGaps ?? [],
    weakSections: raw.weakSections ?? [],
    libraryUnused: raw.libraryUnused ?? [],
  };
}

// ─── Phase 3: Revision Plan ──────────────────────

const REVISION_PLAN_PROMPT = `You are a literature review revision planning expert. Based on the draft analysis and gap analysis, create a detailed, actionable revision plan.

For each section, specify:
- action: "add" (new section), "expand" (add content/citations), "restructure" (reorganize), "keep" (no changes)
- Specific changes to make (in Chinese)
- Which papers to incorporate

Be specific and actionable. This plan will be shown to the user for approval.

Output strict JSON:
{
  "sections": [{
    "action": "add|expand|restructure|keep",
    "heading": "章节标题",
    "description": "具体修改内容描述（中文，详细）",
    "papersToAdd": ["Paper Title 1", "Paper Title 2"],
    "priority": "high|medium|low"
  }],
  "overallStrategy": "整体修改策略描述（中文，2-3句）",
  "estimatedChanges": "新增X节、扩展Y节、调整Z处"
}`;

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
- Add new citations in APA format: (Author, Year)
- Mark NEW sections with 【新增】 at the beginning
- Mark EXPANDED content with 【扩展】 at the beginning
- Mark RESTRUCTURED sections with 【调整】 at the beginning
- Write in academic Chinese (学术中文), clear paragraphs
- Each claim must have a citation
- Maintain logical flow between sections
- Use markdown headings (## for main sections, ### for subsections)
- Include a complete updated reference list at the end (## 参考文献)`;

export async function* rewriteReviewStream(
  draftText: string,
  revisionPlan: RevisionPlan,
  libraryPapers: LibraryPaper[],
  searchPapers: { title: string; authors: string; year: number; venue: string; abstract: string }[],
  provider: AIProvider,
): AsyncGenerator<string> {
  const planContext = revisionPlan.sections
    .filter(s => s.action !== "keep")
    .map(s => `[${s.action.toUpperCase()}] ${s.heading}: ${s.description}\nPapers: ${s.papersToAdd.join("; ")}`)
    .join("\n\n");

  const papersContext = [
    ...libraryPapers.slice(0, 20).map((p, i) => {
      const authors = typeof p.authors === "string" ? p.authors : (p.authors ?? []).map(a => a.name).join(", ");
      return `[Lib-${i + 1}] ${p.title} (${p.year ?? "?"}) — ${authors}\n${p.fullText ? p.fullText.slice(0, 5000) : (p.abstract ?? "No abstract")}`;
    }),
    ...searchPapers.slice(0, 15).map((p, i) =>
      `[New-${i + 1}] ${p.title} (${p.year}) — ${p.authors}\nAbstract: ${p.abstract?.slice(0, 500) ?? "N/A"}`
    ),
  ].join("\n\n" + "=".repeat(30) + "\n\n");

  const stream = streamAI({
    provider,
    messages: [
      { role: "system", content: REWRITE_PROMPT },
      {
        role: "user",
        content: `## Overall Strategy:\n${revisionPlan.overallStrategy}\n\n## Revision Plan:\n${planContext}\n\n## Original Draft:\n${draftText.slice(0, 12000)}\n\n## Available Papers:\n${papersContext}`,
      },
    ],
    temperature: 0.4,
    maxTokens: 8192,
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
