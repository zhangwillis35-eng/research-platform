import { NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { papers, topic, provider = "gemini" } = body as {
      papers: { title: string; abstract?: string; year?: number; venue?: string }[];
      topic: string;
      provider?: AIProvider;
    };

    if (!papers?.length || !topic) {
      return NextResponse.json({ error: "Papers and topic required" }, { status: 400 });
    }

    const content = papers
      .slice(0, 20)
      .map((p, i) => `[${i + 1}] ${p.title} (${p.year ?? "N/A"})\n${p.abstract ?? ""}`)
      .join("\n---\n");

    const response = await callAI({
      provider,
      system: `你是管理学理论分析专家。从文献中识别所有使用的理论框架，并发现跨理论连接。

输出严格 JSON：
{
  "theories": [
    {
      "id": "theory-1",
      "name": "理论名称",
      "nameEn": "English Name",
      "coreConstructs": ["构念1", "构念2"],
      "assumptions": ["假设1"],
      "boundaries": ["边界条件1"],
      "papers": [1, 3]
    }
  ],
  "connections": [
    {
      "from": "theory-1",
      "to": "theory-2",
      "sharedConstructs": ["共享构念"],
      "integrationPotential": "如何整合的说明",
      "strength": "strong|moderate|weak"
    }
  ],
  "framework": {
    "title": "整合框架标题",
    "description": "框架描述",
    "centralTheory": "theory-1",
    "layers": [
      { "name": "层级名", "theories": ["theory-1"], "role": "该层的角色说明" }
    ]
  }
}`,
      messages: [
        {
          role: "user",
          content: `研究主题: ${topic}\n\n文献:\n${content}`,
        },
      ],
      jsonMode: true,
      temperature: 0.3,
    });

    try {
      return NextResponse.json(JSON.parse(response.content));
    } catch {
      return NextResponse.json({ theories: [], connections: [], raw: response.content });
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Theory analysis failed", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
