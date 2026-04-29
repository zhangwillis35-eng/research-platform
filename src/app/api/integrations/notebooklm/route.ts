import { NextResponse } from "next/server";
import {
  checkMCPHealth,
  queryNotebook,
  batchQueryNotebook,
  listNotebooks,
} from "@/lib/integrations/notebooklm-mcp";
import {
  generateReviewQuestions,
  generateVariableQuestions,
  generateTheoryQuestions,
  generateIdeaQuestions,
} from "@/lib/integrations/notebooklm";

/**
 * NotebookLM integration — uses MCP HTTP server directly.
 *
 * Prerequisites:
 *   notebooklm-mcp --transport http --port 27126 --query-timeout 120
 *
 * Actions:
 *   - check: health check
 *   - analyze: run structured queries for variables/review/theories/ideas
 *   - query: single query to a notebook
 *   - list: list available notebooks
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, ...payload } = body as {
      action: "check" | "analyze" | "query" | "list";
      [key: string]: unknown;
    };

    switch (action) {
      case "check": {
        const health = await checkMCPHealth();
        return NextResponse.json({
          available: health.available,
          mode: "mcp",
          error: health.error,
        });
      }

      case "list": {
        const notebooks = await listNotebooks();
        return NextResponse.json({ notebooks });
      }

      case "query": {
        const notebookId = payload.notebookId as string;
        const query = payload.query as string;
        const conversationId = payload.conversationId as string | undefined;

        if (!notebookId || !query) {
          return NextResponse.json(
            { error: "notebookId and query required" },
            { status: 400 }
          );
        }

        const result = await queryNotebook(notebookId, query, conversationId);
        return NextResponse.json(result);
      }

      case "analyze": {
        const topic = payload.topic as string;
        const type = payload.type as string;
        const notebookId = payload.notebookId as string;

        if (!topic) {
          return NextResponse.json(
            { error: "Topic required" },
            { status: 400 }
          );
        }

        // Generate structured questions
        let queries;
        switch (type) {
          case "review":
            queries = generateReviewQuestions(
              topic,
              (payload.paperCount as number) ?? 0
            );
            break;
          case "variables":
            queries = generateVariableQuestions(topic);
            break;
          case "theories":
            queries = generateTheoryQuestions(topic);
            break;
          case "ideas":
            queries = generateIdeaQuestions(topic);
            break;
          default:
            queries = generateReviewQuestions(topic, 0);
        }

        // If notebookId provided, run via MCP
        if (notebookId) {
          const combined = await batchQueryNotebook(
            notebookId,
            queries.map((q) => ({
              question: q.question,
              purpose: q.purpose,
            }))
          );

          return NextResponse.json({
            combined,
            mode: "mcp",
            queryCount: queries.length,
          });
        }

        // Fallback: return questions for manual mode
        return NextResponse.json({
          questions: queries.map((q) => ({
            question: q.question,
            purpose: q.purpose,
          })),
          mode: "manual",
          instructions:
            "NotebookLM MCP 未配置 notebookId。请手动在 NotebookLM 中提问。",
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("[notebooklm] Error:", error);
    return NextResponse.json(
      { error: "NotebookLM error", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
