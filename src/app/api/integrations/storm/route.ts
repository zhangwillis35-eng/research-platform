import { NextResponse } from "next/server";
import {
  checkStormAvailable,
  runStormAnalysis,
  type StormPaper,
  type StormMode,
} from "@/lib/integrations/storm";

/**
 * POST /api/integrations/storm
 *
 * Actions:
 *   - check: verify STORM is installed
 *   - analyze: run STORM literature review on papers
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, ...payload } = body as {
      action: "check" | "analyze";
      [key: string]: unknown;
    };

    switch (action) {
      case "check": {
        const status = await checkStormAvailable();
        return NextResponse.json(status);
      }

      case "analyze": {
        const topic = payload.topic as string;
        const papers = payload.papers as StormPaper[];
        const mode = (payload.mode as StormMode) ?? "review";

        if (!topic || !papers?.length) {
          return NextResponse.json(
            { error: "topic and papers required" },
            { status: 400 }
          );
        }

        const result = await runStormAnalysis(topic, papers, { mode });

        return NextResponse.json(result);
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("[storm-api] Error:", error);
    return NextResponse.json(
      { error: "STORM error", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
