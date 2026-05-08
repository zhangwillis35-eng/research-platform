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
  // Step 0: Auth + parse body (non-streaming, fail fast)
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    setAIContext(auth.id, "/api/papers/reference-search");
  } catch {
    return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
  }

  let references: string;
  let provider: AIProvider;
  try {
    const body = await request.json();
    references = body.references ?? "";
    provider = (body.provider ?? "deepseek-fast") as AIProvider;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!references.trim()) {
    return NextResponse.json({ error: "references text required" }, { status: 400 });
  }

  // Step 1: Extract titles using LLM (non-streaming, fail fast)
  let titles: string[];
  try {
    const extractResult = await callAI({
      provider,
      system: EXTRACT_TITLES_PROMPT,
      messages: [{ role: "user", content: references }],
      noThinking: true,

      temperature: 0,
    });

    titles = extractResult.content
      .split("\n")
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 10 && t.length < 300);
  } catch (err) {
    console.error("[reference-search] LLM extraction failed:", err);
    return NextResponse.json({ error: "AI 提取标题失败: " + String(err) }, { status: 500 });
  }

  if (titles.length === 0) {
    return NextResponse.json({ error: "未能从参考文献中提取到论文标题" }, { status: 400 });
  }

  // Step 2+3: Search + enrich via SSE stream
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream closed */ }
      }

      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: keepalive\n\n`)); } catch { /* closed */ }
      }, 15000);

      try {
        send({ type: "titles", titles, message: `提取到 ${titles.length} 篇论文标题，开始逐篇精确检索...` });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allPapers: Array<{ title: string; found: boolean; paper?: any }> = [];

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

              const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, "");
              const match = papers.find((p) => {
                const pNorm = p.title.toLowerCase().replace(/[^a-z0-9]/g, "");
                const shorter = Math.min(normalized.length, pNorm.length);
                const longer = Math.max(normalized.length, pNorm.length);
                if (shorter < 20) return pNorm.includes(normalized) || normalized.includes(pNorm);
                return longer > 0 && shorter / longer > 0.8;
              });

              return { title, found: !!match, paper: match ?? papers[0] };
            } catch {
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

        // Enrich (cap at 30)
        const foundPapers = allPapers.filter((p) => p.paper).map((p) => p.paper!).slice(0, 30);
        let enriched = foundPapers;
        try {
          if (foundPapers.length > 0) {
            send({ type: "status", message: `找到 ${foundPapers.length}/${titles.length} 篇，补全元数据...` });
            enriched = await enrichPapersBatch(foundPapers);
          }
        } catch { /* continue with unenriched */ }

        const result = allPapers.map((item) => {
          const ep = item.paper
            ? enriched.find((p) =>
                p.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60) ===
                item.paper!.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60)
              ) ?? item.paper
            : null;
          return { queryTitle: item.title, found: item.found, paper: ep };
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
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
