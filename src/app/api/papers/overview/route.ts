import { requireAuth } from "@/lib/auth";
import { streamAI, setAIContext } from "@/lib/ai";
import { NextResponse } from "next/server";
import type { AIProvider } from "@/lib/ai/types";
import { batchStream } from "@/lib/batch-stream";

export const maxDuration = 120;

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  setAIContext(auth.id, "/api/papers/overview");

  try {
    const { query, papers, provider = "deepseek-fast" } = await request.json();

    if (!papers?.length) {
      return NextResponse.json({ error: "No papers to analyze" }, { status: 400 });
    }

    const paperList = papers
      .map(
        (p: { title: string; authors: string[]; year?: number; venue?: string; abstract?: string; citationCount?: number; relevanceScore?: number; rankings?: string[] }, i: number) =>
          `[${i + 1}] ${p.title} (${p.year ?? "N/A"}) — ${p.venue ?? "Unknown venue"}${p.rankings?.length ? ` [${p.rankings.join(", ")}]` : ""}\n    Authors: ${p.authors?.slice(0, 3).join(", ") ?? "Unknown"}${p.authors?.length > 3 ? " et al." : ""}\n    Citations: ${p.citationCount ?? 0}${p.relevanceScore != null ? ` | Relevance: ${p.relevanceScore}/10` : ""}\n    Abstract: ${p.abstract ?? "No abstract"}`
      )
      .join("\n\n");

    const system = `You are a senior research assistant in management studies. The user has just completed a literature search. Provide a comprehensive, in-depth overview analysis of the search results.

Your analysis MUST include all of the following sections (write thoroughly, do not skip any):

Section 1: Overall Summary (3-5 sentences)
- Total papers found, time span (earliest to most recent year)
- Core domains and interdisciplinary intersections
- Quality distribution (how many in top journals: UTD24/FT50/ABS4*/SSCI)
- Citation overview (total, average, highest-cited paper)

Section 2: Thematic Classification & Deep Analysis (4-6 categories)
For each category:
- Category name (marked with「」)
- List all paper numbers belonging to this category (e.g., [1][3][7])
- Core research questions and main findings
- Main theoretical frameworks used
- Research methods (empirical/case/review/experiment)
- Research evolution trends (early to recent changes)

Section 3: Methodology Analysis
- Main research methods and count of papers using each
- Data sources (survey, secondary data, experiment, case study, etc.)
- Any noteworthy methodological innovations

Section 4: Theoretical Framework Review
- Core theories involved (e.g., RBV, institutional theory, signaling theory)
- Most frequently used theories and innovative applications

Section 5: Recommended Deep Reads (3-5 papers)
For each:
- Paper number and title
- Why recommended (high citations, methodological innovation, theoretical contribution, pioneering)
- Core findings or key contributions

Section 6: Research Gaps & Future Directions
- List 3-5 specific research gaps (based on literature analysis, not generic)
- Why each gap is worth filling
- Possible research questions or hypothesis directions

Format requirements:
- Respond in Chinese
- Use section headers (「一、整体概况」), separate sections with blank lines
- Mark category and theory names with「」
- Cite papers with [number]
- Analysis should be deep, not surface-level
- Minimum 1500 Chinese characters, be thorough and comprehensive`;

    const stream = streamAI({
      provider: provider as AIProvider,
      signal: request.signal,
      messages: [
        {
          role: "user",
          content: `用户检索主题: "${query}"\n\n检索到 ${papers.length} 篇文献:\n\n${paperList}\n\n请对以上检索结果进行全面、深入的概览分析。`,
        },
      ],
      system,
      noThinking: true,

      temperature: 0.3,
      maxTokens: 4096,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
          const keepalive = setInterval(() => {
            try { controller.enqueue(encoder.encode(`: keepalive

`)); } catch { /* closed */ }
          }, 10000);
        try {
          for await (const chunk of batchStream(stream, 30)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
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
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("[overview] Error:", error);
    return NextResponse.json(
      { error: "Overview generation failed", details: String(error) },
      { status: 500 }
    );
  }
}
