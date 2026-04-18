import { NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";

interface Paper {
  title: string;
  abstract?: string;
  authors?: { name: string }[];
  year?: number;
  venue?: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { papers, provider = "gemini" } = body as {
      papers: Paper[];
      provider?: AIProvider;
    };

    if (!papers?.length) {
      return NextResponse.json({ error: "Papers required" }, { status: 400 });
    }

    const content = papers
      .slice(0, 20)
      .map(
        (p, i) =>
          `[${i + 1}] ${p.title} (${p.year ?? "N/A"})\n${p.abstract ?? ""}`
      )
      .join("\n---\n");

    const response = await callAI({
      provider,
      system: `你是管理学研究方法论专家。从以下论文中提取所有变量关系，构建知识图谱。

输出严格的 JSON 格式：
{
  "nodes": [
    { "id": "变量名", "type": "IV|DV|MEDIATOR|MODERATOR|CONTROL", "frequency": 1 }
  ],
  "edges": [
    { "source": "变量A", "target": "变量B", "type": "DIRECT|MEDIATION|MODERATION", "direction": "positive|negative|mixed", "weight": 1, "papers": [1,2] }
  ]
}

规则：
1. 变量名统一用英文，简洁明确
2. type: IV=自变量, DV=因变量, MEDIATOR=中介, MODERATOR=调节, CONTROL=控制
3. frequency = 在几篇文献中出现
4. weight = 多少篇文献支持该关系
5. papers = 支持文献编号列表
6. 合并同义变量（如 firm performance 和 corporate performance 合并为 Firm Performance）`,
      messages: [{ role: "user", content }],
      jsonMode: true,
      temperature: 0.2,
    });

    try {
      const graph = JSON.parse(response.content);
      return NextResponse.json(graph);
    } catch {
      return NextResponse.json({ nodes: [], edges: [], raw: response.content });
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Graph extraction failed", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
