import { NextResponse } from "next/server";
import {
  checkConnection,
  pushIdeaToObsidian,
  pushPaperToObsidian,
  pullIdeaSeeds,
  searchNotes,
  type ObsidianConfig,
  type ResearchIdeaForObsidian,
  type PaperForObsidian,
  DEFAULT_BASE_URL,
} from "@/lib/integrations/obsidian";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, config: userConfig, ...payload } = body as {
      action: "check" | "push-idea" | "push-paper" | "pull-seeds" | "search";
      config: { baseUrl?: string; apiKey: string };
      [key: string]: unknown;
    };

    const config: ObsidianConfig = {
      baseUrl: userConfig?.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: userConfig?.apiKey ?? "",
    };

    if (!config.apiKey && action !== "check") {
      return NextResponse.json(
        { error: "Obsidian API key is required" },
        { status: 400 }
      );
    }

    switch (action) {
      case "check": {
        const status = await checkConnection(config);
        return NextResponse.json(status);
      }

      case "push-idea": {
        const idea = payload.idea as ResearchIdeaForObsidian;
        const folder = (payload.folder as string) ?? "ScholarFlow/Ideas";
        if (!idea) {
          return NextResponse.json({ error: "Idea is required" }, { status: 400 });
        }
        const success = await pushIdeaToObsidian(config, idea, folder);
        const filename = idea.title.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
        return NextResponse.json({ success, path: `${folder}/${filename}.md` });
      }

      case "push-paper": {
        const paper = payload.paper as PaperForObsidian;
        const folder = (payload.folder as string) ?? "ScholarFlow/Papers";
        if (!paper) {
          return NextResponse.json({ error: "Paper is required" }, { status: 400 });
        }
        const success = await pushPaperToObsidian(config, paper, folder);
        const filename = paper.title.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
        return NextResponse.json({ success, path: `${folder}/${filename}.md` });
      }

      case "pull-seeds": {
        const tags = (payload.tags as string[]) ?? ["research-idea", "research"];
        const seeds = await pullIdeaSeeds(config, tags);
        return NextResponse.json({ seeds, count: seeds.length });
      }

      case "search": {
        const query = payload.query as string;
        if (!query) {
          return NextResponse.json({ error: "Query is required" }, { status: 400 });
        }
        const results = await searchNotes(config, query);
        return NextResponse.json({ results, count: results.length });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Obsidian integration error", details: String(error) },
      { status: 500 }
    );
  }
}
