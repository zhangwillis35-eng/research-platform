import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import {
  analyzeDraft,
  analyzeGaps,
  generateRevisionPlan,
  rewriteReviewStream,
  integratePapersStream,
  type LibraryPaper,
  type DraftAnalysis,
  type GapAnalysis,
} from "@/lib/research/review-enhance";
import { smartSearch } from "@/lib/research/smart-search";

export const maxDuration = 300;

// ─── Extract text from .docx ────────────────────

async function handleExtractDocx(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const mammoth = await import("mammoth");
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await mammoth.extractRawText({ buffer });
  const html = (await mammoth.convertToHtml({ buffer })).value;

  return NextResponse.json({
    text: result.value,
    html,
    charCount: result.value.length,
  });
}

// ─── SSE helper ─────────────────────────────────

function createSSEStream(
  handler: (send: (data: Record<string, unknown>) => void, signal: AbortSignal) => Promise<void>,
) {
  const encoder = new TextEncoder();
  let aborted = false;
  const abortController = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        if (aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream closed */ }
      };

      // Keepalive
      const keepalive = setInterval(() => {
        if (!aborted) send({ type: "ping" });
      }, 15000);

      try {
        await handler(send, abortController.signal);
      } catch (err) {
        send({ type: "error", error: String(err) });
      } finally {
        clearInterval(keepalive);
        if (!aborted) controller.close();
      }
    },
    cancel() {
      aborted = true;
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── Main handler ───────────────────────────────

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  setAIContext(auth.id, "/api/research/review-enhance");

  // Check content type for multipart (docx extraction)
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return handleExtractDocx(request);
  }

  const body = await request.json();
  const { action, provider = "deepseek-fast" } = body as {
    action: string;
    provider?: AIProvider;
  };

  // Use deepseek-fast for internal pipeline steps (search, gap analysis, plan generation)
  // User's model choice only affects the final rewrite/chat quality
  const pipelineProvider: AIProvider = "deepseek-fast";

  // ── analyze-draft ──
  if (action === "analyze-draft") {
    const { draftText, libraryPapers } = body as {
      draftText: string;
      libraryPapers: LibraryPaper[];
    };

    return createSSEStream(async (send) => {
      send({ type: "status", message: "正在分析综述初稿..." });
      const analysis = await analyzeDraft(draftText, libraryPapers, pipelineProvider);
      send({ type: "analysis", data: analysis });
      send({ type: "done" });
    });
  }

  // ── search-gaps ──
  if (action === "search-gaps") {
    const { keywords, citedRefs, projectId, journalLang = "en", draftAnalysis, libraryPapers } = body as {
      keywords: string[];
      citedRefs: string[];
      projectId: string;
      journalLang?: "en" | "zh";
      draftAnalysis: DraftAnalysis;
      libraryPapers: LibraryPaper[];
    };

    return createSSEStream(async (send) => {
      // Step 1: Use full smartSearch pipeline (same as 文献检索)
      // One call with combined keywords — includes LLM keyword expansion,
      // multi-source search, dedup, enrichment, and AI relevance scoring
      const searchQuery = keywords.slice(0, 5).join(", ");
      send({ type: "status", message: `正在检索补充文献: ${searchQuery.slice(0, 60)}...` });

      const searchResult = await smartSearch(
        searchQuery,
        pipelineProvider,
        50,
        true, // enable AI relevance scoring (same quality as main search)
        (phase, detail) => send({ type: "status", message: detail }),
        journalLang,
      );

      const searchPapersRaw = searchResult.papers.slice(0, 50);
      send({ type: "status", message: `检索到 ${searchPapersRaw.length} 篇高质量论文，正在批量分析...` });

      // Step 2: Batch AI analysis (1 call per 10 papers instead of 1 per paper)
      const { callAI: callAIBatch } = await import("@/lib/ai");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const analyzedPapers: Array<any> = [];

      const BATCH = 10;
      for (let i = 0; i < searchPapersRaw.length; i += BATCH) {
        const batch = searchPapersRaw.slice(i, i + BATCH);
        send({ type: "status", message: `批量分析: ${Math.min(i + BATCH, searchPapersRaw.length)}/${searchPapersRaw.length}...` });

        const paperList = batch.map((p, j) => {
          const authors = typeof p.authors === "string" ? p.authors : (p.authors ?? []).map((a: { name: string }) => a.name).join(", ");
          return `[${j}] ${p.title} (${p.year}) — ${authors} | ${p.venue}\n摘要: ${(p.abstract ?? "").slice(0, 300)}`;
        }).join("\n\n");

        let batchAnalysis: Record<string, string> = {};
        try {
          const res = await callAIBatch({
            provider: pipelineProvider,
            system: `分析以下学术论文。对每篇论文，用1-2句话总结核心发现和理论贡献。
Output JSON: {"0": "分析...", "1": "分析...", ...} — key是论文编号。`,
            messages: [{ role: "user", content: paperList }],
            jsonMode: true,
            noThinking: true,
            temperature: 0.2,
            maxTokens: 2000,
          });
          batchAnalysis = JSON.parse(res.content);
        } catch { /* skip */ }

        for (let j = 0; j < batch.length; j++) {
          const p = batch[j];
          const authors = typeof p.authors === "string" ? p.authors : (p.authors ?? []).map((a: { name: string }) => a.name).join(", ");
          const ext = p as unknown as Record<string, unknown>;
          analyzedPapers.push({
            title: p.title,
            authors,
            year: p.year ?? 0,
            venue: String(p.venue ?? ""),
            abstract: p.abstract ?? "",
            aiAnalysis: batchAnalysis[String(j)] ?? "",
            citationCount: p.citationCount ?? 0,
            doi: p.doi,
            relevanceScore: ext.relevanceScore,
            relevanceReason: ext.relevanceReason,
            journalRanking: ext.journalRanking ?? p.journalRanking,
            journalMeta: ext.journalMeta ?? p.journalMeta,
          });
        }
      }

      send({ type: "status", message: `${analyzedPapers.length} 篇分析完成，正在 Gap 检测...` });

      // Step 3: Topic grouping + gap analysis
      const gaps = await analyzeGaps(draftAnalysis, analyzedPapers, libraryPapers, pipelineProvider);
      send({ type: "gaps", data: gaps, searchCount: searchPapersRaw.length });
      send({ type: "done" });
    });
  }

  // ── generate-plan ──
  if (action === "generate-plan") {
    const { draftText, draftAnalysis, gapAnalysis, libraryPapers, engine } = body as {
      draftText: string;
      draftAnalysis: DraftAnalysis;
      gapAnalysis: GapAnalysis;
      libraryPapers: LibraryPaper[];
      engine?: string;
    };

    return createSSEStream(async (send) => {
      let stormContext: string | undefined;

      // Optional STORM enhancement
      if (engine === "storm") {
        send({ type: "status", message: "正在使用 STORM 进行深度分析..." });
        try {
          const { runStormAnalysis, checkStormAvailable } = await import("@/lib/integrations/storm");
          const check = await checkStormAvailable();
          if (check.available) {
            const stormPapers = libraryPapers.slice(0, 15).map(p => ({
              title: p.title,
              abstract: p.abstract ?? undefined,
              authors: typeof p.authors === "string" ? p.authors : (p.authors ?? []).map(a => a.name).join(", "),
              year: p.year ?? undefined,
              venue: p.venue ?? undefined,
              fullText: p.fullText?.slice(0, 5000) ?? undefined,
            }));
            const result = await runStormAnalysis(draftAnalysis.topic, stormPapers, { mode: "gaps" });
            if (result.status === "success") {
              stormContext = result.article;
            }
          }
        } catch { /* STORM unavailable, continue without */ }
      }

      send({ type: "status", message: "正在生成修改计划..." });
      const plan = await generateRevisionPlan(draftText, draftAnalysis, gapAnalysis, libraryPapers, pipelineProvider, stormContext);
      send({ type: "plan", data: plan });
      send({ type: "done" });
    });
  }

  // ── rewrite ──
  if (action === "rewrite") {
    const { draftText, revisionPlan, libraryPapers, searchPapers, wordCount } = body as {
      draftText: string;
      revisionPlan: { sections: { action: string; heading: string; description: string; papersToAdd: string[]; priority: string }[]; overallStrategy: string; estimatedChanges: string };
      libraryPapers: LibraryPaper[];
      searchPapers: { title: string; authors: string; year: number; venue: string; abstract: string }[];
      wordCount?: { min: number; max: number };
    };

    return createSSEStream(async (send) => {
      send({ type: "status", message: "正在优化综述..." });
      const gen = rewriteReviewStream(
        draftText,
        revisionPlan as import("@/lib/research/review-enhance").RevisionPlan,
        libraryPapers,
        searchPapers,
        provider,
        wordCount,
      );
      for await (const chunk of gen) {
        send({ type: "text", text: chunk });
      }
      send({ type: "done" });
    });
  }

  // ── integrate-papers ──
  if (action === "integrate-papers") {
    const { existingReview, newPapers } = body as {
      existingReview: string;
      newPapers: LibraryPaper[];
    };

    return createSSEStream(async (send) => {
      send({ type: "status", message: `正在整合 ${newPapers.length} 篇新增文献...` });
      const gen = integratePapersStream(existingReview, newPapers, provider);
      for await (const chunk of gen) {
        send({ type: "text", text: chunk });
      }
      send({ type: "done" });
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
