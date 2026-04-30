/**
 * Proposal generation API — AI generates structured research proposal sections.
 *
 * Supports streaming for real-time output.
 * Sections: Title, Introduction, Literature Review, Theoretical Framework,
 * Hypotheses, Methodology, Expected Contributions, References
 */
import { streamAI, setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";
import { formatCitation } from "@/lib/citation";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PROPOSAL_SYSTEM = `你是一位管理学领域的资深教授，擅长撰写高质量的学术研究计划书（Research Proposal）。

你需要根据用户提供的研究主题、文献和研究想法，生成一份完整的 Research Proposal。

请按以下结构撰写（每个部分用 ## 标题标记）：

## 1. 研究标题 (Research Title)
提出一个准确、简洁且学术化的标题。

## 2. 引言 (Introduction)
- 研究背景和现实动机
- 研究问题的提出
- 研究意义（理论贡献+实践意义）
- 研究创新点

## 3. 文献综述 (Literature Review)
- 按主题聚类归纳已有研究
- 标注引用 [作者, 年份]
- 识别研究空白

## 4. 理论框架与假设 (Theoretical Framework & Hypotheses)
- 核心理论基础
- 概念模型描述
- 研究假设（H1, H2, H3...）及推导逻辑

## 5. 研究方法 (Methodology)
- 研究设计（实证/实验/案例等）
- 样本与数据来源
- 变量测量
- 分析方法

## 6. 预期贡献 (Expected Contributions)
- 理论贡献
- 实践意义
- 方法论创新（如有）

## 7. 参考文献 (References)
- 列出所有引用的文献（APA格式）

要求：
- 学术写作风格，逻辑严谨
- 引用文献时标注 [Author, Year]
- 每个部分 200-400 字
- 假设要有清晰的理论推导
- 用中文撰写，关键术语保留英文`;

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    setAIContext(auth.id, "/api/research/proposal");

    const body = await request.json();
    const { topic, papers, ideas, provider = "gemini-pro" } = body as {
      topic: string;
      papers?: UnifiedPaper[];
      ideas?: string[];
      provider?: AIProvider;
    };

    if (!topic) {
      return new Response(
        JSON.stringify({ error: "Topic required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build paper context
    let paperContext = "";
    if (papers?.length) {
      const citations = await Promise.all(
        papers.map((p) =>
          formatCitation(
            { title: p.title, authors: p.authors, year: p.year, venue: p.venue, doi: p.doi },
            "apa"
          )
        )
      );

      paperContext = papers
        .map(
          (p, i) =>
            `[${i + 1}] ${p.title}\n作者: ${p.authors.map((a) => a.name).join(", ")} (${p.year ?? "N/A"})\n期刊: ${p.venue ?? ""}\n摘要: ${p.abstract ?? "(无)"}\nAPA引用: ${citations[i]}`
        )
        .join("\n\n");
    }

    const userContent = [
      `研究主题: ${topic}`,
      papers?.length ? `\n已有文献 (${papers.length} 篇):\n${paperContext}` : "",
      ideas?.length ? `\n研究想法:\n${ideas.map((id, i) => `${i + 1}. ${id}`).join("\n")}` : "",
      "\n请基于以上信息，生成一份完整的 Research Proposal。",
    ].join("\n");

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = streamAI({
            provider,
            system: PROPOSAL_SYSTEM,
            messages: [{ role: "user", content: userContent }],
            maxTokens: 8192,
            temperature: 0.4,
          });

          for await (const chunk of stream) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`)
            );
          }

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
          );
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`
            )
          );
        }
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
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Proposal generation failed", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const maxDuration = 120;
