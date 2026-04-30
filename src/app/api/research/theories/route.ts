import { NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

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
      system: `You are a management theory analysis expert. Identify all theoretical frameworks used in the literature and discover cross-theory connections.

Output strict JSON. Use Chinese for all descriptive text fields:
{
  "theories": [
    {
      "id": "theory-1",
      "name": "theory name in Chinese",
      "nameEn": "English Name",
      "coreConstructs": ["construct 1 in Chinese", "construct 2"],
      "assumptions": ["assumption in Chinese"],
      "boundaries": ["boundary condition in Chinese"],
      "papers": [1, 3]
    }
  ],
  "connections": [
    {
      "from": "theory-1",
      "to": "theory-2",
      "sharedConstructs": ["shared construct in Chinese"],
      "integrationPotential": "integration explanation in Chinese",
      "strength": "strong|moderate|weak"
    }
  ],
  "framework": {
    "title": "framework title in Chinese",
    "description": "framework description in Chinese",
    "centralTheory": "theory-1",
    "layers": [
      { "name": "layer name in Chinese", "theories": ["theory-1"], "role": "role description in Chinese" }
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
