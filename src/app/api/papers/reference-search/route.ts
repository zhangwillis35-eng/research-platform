import { requireAuth } from "@/lib/auth";
import { callAI, setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { searchAllSourcesRaw, enrichPapersBatch } from "@/lib/sources/aggregator";
import { NextResponse } from "next/server";

const EXTRACT_TITLES_PROMPT = `You are a reference list parser. Extract paper titles from the provided reference list.

Rules:
- Extract ONLY the paper title from each reference entry
- Remove author names, year, journal name, volume, pages, DOI — keep ONLY the title
- Handle ALL common citation formats: APA, MLA, Chicago, Harvard, Vancouver, numbered, etc.
- Each title should be on its own line
- Do NOT add numbering or bullet points
- Do NOT include titles that are clearly book titles (look for publisher names like "Press", "Publishing")
- If a line doesn't contain a recognizable reference, skip it
- Output ONLY the titles, one per line, nothing else

Example input:
1. Smith, J. (2020). Digital transformation and organizational resilience. Journal of Management, 46(3), 123-145.
2. Zhang, W., & Lee, K. (2021). AI adoption in healthcare: A systematic review. MIS Quarterly, 45(2), 567-589.

Example output:
Digital transformation and organizational resilience
AI adoption in healthcare: A systematic review`;

export async function POST(request: Request) {
  // Auth check BEFORE streaming
  let userId = "unknown";
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    userId = auth.id;
  } catch (err) {
    console.error("[reference-search] Auth error:", err);
    return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
  }

  let body: { references?: string; provider?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const references = body.references ?? "";
  const provider = (body.provider ?? "deepseek-fast") as AIProvider;

  if (!references.trim()) {
    return NextResponse.json({ error: "references text required" }, { status: 400 });
  }

  setAIContext(userId, "/api/papers/reference-search");

  // SSE streaming for progress
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream closed */ }
      }

      // Keepalive to prevent nginx timeout
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: keepalive\n\n`)); } catch { /* closed */ }
      }, 15000);

      try {
        // Step 1: Extract titles using LLM
        send({ type: "status", message: "AI 正在从参考文献中提取论文标题..." });

        const extractResult = await callAI({
          provider,
          system: EXTRACT_TITLES_PROMPT,
          messages: [{ role: "user", content: references }],
          temperature: 0,
        });

        const titles = extractResult.content
          .split("\n")
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 10 && t.length < 300);

        if (titles.length === 0) {
          send({ type: "error", error: "未能从参考文献中提取到论文标题，请检查参考文献格式" });
          clearInterval(keepalive);
          controller.close();
          return;
        }

        send({ type: "status", message: `提取到 ${titles.length} 篇论文标题，开始逐篇精确检索...` });
        send({ type: "titles", titles });

        // Step 2: Search each title as exact phrase
        const allPapers: Array<{
          title: string;
          found: boolean;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          paper?: any;
        }> = [];

        // Batch search: 3 concurrent (conservative to avoid rate limits)
        const batchSize = 3;
        for (let i = 0; i < titles.length; i += batchSize) {
          const batch = titles.slice(i, i + batchSize);
          const promises = batch.map(async (title: string) => {
            try {
              const { papers } = await searchAllSourcesRaw({
                query: `"${title}"`,
                limit: 3,
                freeOnly: true,
              });

              // Find best match by title similarity
              const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, "");
              const match = papers.find((p) => {
                const pNorm = p.title.toLowerCase().replace(/[^a-z0-9]/g, "");
                const shorter = Math.min(normalized.length, pNorm.length);
                const longer = Math.max(normalized.length, pNorm.length);
                if (shorter < 20) return pNorm.includes(normalized) || normalized.includes(pNorm);
                return longer > 0 && shorter / longer > 0.8;
              });

              return { title, found: !!match, paper: match ?? papers[0] };
            } catch (err) {
              console.error(`[reference-search] Search failed for: ${title.slice(0, 50)}`, err);
              return { title, found: false };
            }
          });

          const results = await Promise.all(promises);
          allPapers.push(...results);

          send({
            type: "progress",
            searched: Math.min(i + batchSize, titles.length),
            total: titles.length,
            found: allPapers.filter((p) => p.found).length,
          });
        }

        // Step 3: Enrich found papers (cap at 30 to avoid timeout)
        const foundPapers = allPapers.filter((p) => p.paper).map((p) => p.paper!);
        const toEnrich = foundPapers.slice(0, 30);
        send({ type: "status", message: `找到 ${foundPapers.length}/${titles.length} 篇，正在补全元数据...` });

        let enriched = toEnrich;
        try {
          if (toEnrich.length > 0) {
            enriched = await enrichPapersBatch(toEnrich);
          }
        } catch (err) {
          console.error("[reference-search] Enrichment failed:", err);
          // Continue with unenriched papers
        }

        // Build result with match status
        const result = allPapers.map((item) => {
          const enrichedPaper = item.paper
            ? enriched.find((p) =>
                p.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60) ===
                item.paper!.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60)
              ) ?? item.paper
            : null;

          return {
            queryTitle: item.title,
            found: item.found,
            paper: enrichedPaper,
          };
        });

        send({
          type: "result",
          papers: result.filter((r) => r.paper).map((r) => r.paper),
          matchResults: result,
          stats: {
            total: titles.length,
            found: result.filter((r) => r.found).length,
            notFound: result.filter((r) => !r.found).length,
          },
        });
        send({ type: "done" });
      } catch (err) {
        console.error("[reference-search] Pipeline error:", err);
        send({ type: "error", error: String(err) });
      }

      clearInterval(keepalive);
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
