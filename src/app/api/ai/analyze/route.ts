import { NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";

const ANALYSIS_PROMPTS: Record<string, string> = {
  variables: `你是管理学研究方法论专家。从以下论文摘要中提取所有变量关系。

请严格按以下JSON格式输出：
{
  "relations": [
    {
      "independentVar": "自变量名称",
      "dependentVar": "因变量名称",
      "mediators": ["中介变量1"],
      "moderators": ["调节变量1"],
      "direction": "positive/negative/mixed/unknown",
      "effectSize": "如有提及",
      "sampleContext": "样本情境描述"
    }
  ]
}

如果无法提取，返回 {"relations": []}。只输出JSON，不要其他文字。`,

  review: `你是管理学文献综述专家。基于以下文献信息，生成结构化文献综述。

请按以下结构组织：
1. **研究主题聚类**：将文献按主题分组，说明每组的核心发现
2. **时间脉络**：研究在时间上的演进趋势
3. **研究Gap**：现有文献尚未充分探索的领域
4. **未来方向**：基于Gap提出的可能研究方向

请用中文回答，保持学术写作风格。`,

  ideas: `你是管理学研究创新专家。基于以下文献中的理论、情境和方法信息，生成新的研究想法。

对每个想法，请提供：
1. 研究标题
2. 所用理论
3. 研究情境
4. 研究方法
5. 核心假设
6. 预期贡献
7. 新颖性评估（1-10分，附理由）

请严格按JSON格式输出：
{
  "ideas": [
    {
      "title": "",
      "theory": "",
      "context": "",
      "method": "",
      "hypothesis": "",
      "contribution": "",
      "noveltyScore": 0,
      "noveltyReason": ""
    }
  ]
}`,

  theories: `你是管理学理论分析专家。从以下文献中识别所有使用的理论框架。

对每个理论，请提取：
1. 理论名称
2. 核心构念/概念
3. 关键假设
4. 边界条件
5. 在文献中的使用方式（扩展/验证/挑战）

请按JSON格式输出：
{
  "theories": [
    {
      "name": "",
      "coreConstructs": [""],
      "assumptions": [""],
      "boundaries": [""],
      "usage": "extends/tests/challenges"
    }
  ]
}`,
};

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const {
      provider = "gemini",
      type,
      content,
    } = body as {
      provider?: AIProvider;
      type: keyof typeof ANALYSIS_PROMPTS;
      content: string;
    };

    const systemPrompt = ANALYSIS_PROMPTS[type];
    if (!systemPrompt) {
      return NextResponse.json(
        { error: `Unknown analysis type: ${type}` },
        { status: 400 }
      );
    }

    const response = await callAI({
      provider,
      system: systemPrompt,
      messages: [{ role: "user", content }],
      jsonMode: type !== "review",
      temperature: type === "ideas" ? 0.7 : 0.2,
    });

    // Try to parse JSON response for structured types
    let parsed = null;
    if (type !== "review") {
      try {
        parsed = JSON.parse(response.content);
      } catch {
        // If JSON parse fails, return raw content
      }
    }

    return NextResponse.json({
      result: parsed ?? response.content,
      provider: response.provider,
      model: response.model,
      usage: response.usage,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Analysis failed", details: String(error) },
      { status: 500 }
    );
  }
}
