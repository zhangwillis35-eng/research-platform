import { NextResponse } from "next/server";
import { callAI, setAIContext } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { concurrentPool } from "@/lib/concurrent-pool";

const ANALYSIS_PROMPTS: Record<string, string> = {
  variables: `你是管理学研究方法论专家。请从提供的论文中提取所有变量关系。

重要：每篇论文标记为[1]、[2]等。你必须使用"sources"字段记录每个关系来源于哪篇论文。如果同一关系出现在多篇论文中，列出所有来源编号。

请严格按以下JSON格式输出：
{
  "relations": [
    {
      "independentVar": "自变量名称",
      "dependentVar": "因变量名称",
      "mediators": ["中介变量1"],
      "moderators": ["调节变量1"],
      "direction": "positive/negative/mixed/unknown",
      "effectSize": "效应量（如有提及）",
      "sampleContext": "样本情境描述",
      "sources": [1, 3]
    }
  ]
}

规则：
- "sources"必须包含该关系所在论文的编号[1]、[2]等
- 如果同一自变量→因变量关系出现在多篇论文中，合并为一条记录并列出所有来源编号
- 如果不同论文对同一关系发现了不同方向，在direction字段标注"mixed"并列出所有来源
- 变量名称和描述请使用中文
- 如果未发现关系，返回 {"relations": []}
- 仅输出JSON，不要输出其他文字。`,

  review: `你是管理学文献综述专家。基于以下文献信息，生成结构化文献综述。

请按以下结构组织：
1. **研究主题聚类**：将文献按主题分组，说明每组的核心发现
2. **时间脉络**：研究在时间上的演进趋势
3. **研究Gap**：现有文献尚未充分探索的领域
4. **未来方向**：基于Gap提出的可能研究方向

请用中文回答，保持学术写作风格。`,

  ideas: `You are a management research innovation expert. Based on the theories, contexts, and methods in the provided literature, generate new research ideas.

For each idea, provide:
1. Research title
2. Theory used
3. Research context
4. Research method
5. Core hypothesis
6. Expected contribution
7. Novelty evaluation (1-10 with reason)

IMPORTANT: ALL field values MUST be written in Chinese (中文).

Output strictly in JSON format:
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

  model: `You are a conceptual model expert in management research. Based on the provided papers, extract variables and their hypothesized relationships to build a conceptual model.

Output strict JSON (ALL values in Chinese 中文):
{
  "variables": [
    {"name": "变量名称", "type": "iv"},
    {"name": "变量名称", "type": "mediator"},
    {"name": "变量名称", "type": "dv"},
    {"name": "变量名称", "type": "moderator"}
  ],
  "hypotheses": [
    {"from": "自变量名称", "to": "因变量名称", "label": "H1 (+)", "direction": "positive"},
    {"from": "变量A", "to": "变量B", "label": "H2 (-)", "direction": "negative"},
    {"from": "调节变量", "to": "变量B", "label": "H3 (Mod)", "direction": "moderation"}
  ]
}

Rules:
- type must be one of: iv (independent), dv (dependent), mediator, moderator, control
- direction: positive, negative, moderation, mixed
- label format: "H{n} (+/-/Mod)" — number hypotheses sequentially
- Extract 3-8 variables and 3-10 hypotheses from the literature
- If papers describe mediation, include the mediator with separate paths (X→M, M→Y)
- If papers describe moderation, set direction to "moderation"`,

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
    setAIContext(auth.id, "/api/ai/analyze");

    const body = await request.json();
    const {
      provider = "deepseek-fast",
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

    // ── Variables extraction: batch for large paper sets ──
    if (type === "variables") {
      const BATCH_SIZE = 10;
      // Split content by paper separator (--- between [N] entries)
      const paperBlocks = content.split(/\n---\n/).filter(b => b.trim());

      if (paperBlocks.length > BATCH_SIZE) {
        // Batch into groups of BATCH_SIZE, extract in parallel, merge
        const batches: string[][] = [];
        for (let i = 0; i < paperBlocks.length; i += BATCH_SIZE) {
          batches.push(paperBlocks.slice(i, i + BATCH_SIZE));
        }

        interface Relation {
          independentVar: string;
          dependentVar: string;
          mediators: string[];
          moderators: string[];
          direction: string;
          effectSize: string;
          sampleContext: string;
          sources: number[];
        }

        const allRelations: Relation[] = [];

        await concurrentPool(
          batches,
          async (batch, batchIdx) => {
            const offset = batchIdx * BATCH_SIZE;
            // Re-number papers within batch starting from [1]
            const batchContent = batch.map((block, i) => {
              return block.replace(/^\[(\d+)\]/, `[${i + 1}]`);
            }).join("\n---\n");

            try {
              const res = await callAI({
                provider,
                system: systemPrompt,
                messages: [{ role: "user", content: batchContent }],
                jsonMode: true,
                noThinking: true,
                temperature: 0.2,
                maxTokens: 4096,
              });
              const jsonStr = res.content.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
              const parsed = JSON.parse(jsonStr);
              const relations: Relation[] = parsed.relations ?? [];
              // Remap sources back to global paper numbers
              for (const rel of relations) {
                rel.sources = (rel.sources ?? []).map((s: number) => s + offset);
                allRelations.push(rel);
              }
            } catch {
              // Skip failed batch
            }
          },
          4, // 4 concurrent batches
        );

        // Merge: deduplicate same IV→DV pairs, combine sources
        const mergedMap = new Map<string, Relation>();
        for (const rel of allRelations) {
          const key = `${rel.independentVar}→${rel.dependentVar}`;
          const existing = mergedMap.get(key);
          if (existing) {
            existing.sources = [...new Set([...existing.sources, ...rel.sources])];
            existing.mediators = [...new Set([...existing.mediators, ...rel.mediators])];
            existing.moderators = [...new Set([...existing.moderators, ...rel.moderators])];
            if (existing.direction !== rel.direction && rel.direction !== "unknown") {
              existing.direction = existing.direction === "unknown" ? rel.direction : "mixed";
            }
          } else {
            mergedMap.set(key, { ...rel });
          }
        }

        const merged = { relations: [...mergedMap.values()] };
        return NextResponse.json({
          result: merged,
          provider,
          batches: batches.length,
          totalPapers: paperBlocks.length,
        });
      }
    }

    const response = await callAI({
      provider,
      system: systemPrompt,
      messages: [{ role: "user", content }],
      jsonMode: type !== "review",
      noThinking: true,
      temperature: type === "ideas" ? 0.7 : 0.2,
      maxTokens: 4096,
    });

    // Try to parse JSON response for structured types
    let parsed = null;
    if (type !== "review") {
      try {
        const jsonStr = response.content.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
        parsed = JSON.parse(jsonStr);
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
