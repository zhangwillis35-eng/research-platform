/**
 * Smart search with keyword extraction + synonym expansion.
 *
 * 1. Extract key terms from user's natural language input
 * 2. Generate synonyms for each term
 * 3. Precision: search each key term as exact phrase
 * 4. Broad: combine terms + synonyms with OR logic
 * 5. Merge and deduplicate
 */
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { searchAllSources } from "@/lib/sources/aggregator";
import type { UnifiedPaper } from "@/lib/sources/types";

export interface SmartSearchPlan {
  keyTerms: string[];
  synonyms: Record<string, string[]>;
  precisionQueries: string[];
  broadQueries: string[];
}

export interface SmartSearchResult {
  plan: SmartSearchPlan;
  papers: UnifiedPaper[];
  stats: {
    total: number;
    byQuery: Record<string, number>;
    durationMs: number;
  };
}

const EXTRACT_SYSTEM = `你是学术检索专家。用户会用自然语言描述研究兴趣，你需要：

1. 提取 2-5 个核心英文学术关键词/短语
2. 为每个关键词生成 2-4 个同义词或近义表达（英文学术用语）
3. 生成 1-2 个广度检索式（用 OR 连接同义词）

输出严格 JSON：
{
  "keyTerms": ["term1", "term2"],
  "synonyms": {
    "term1": ["synonym1a", "synonym1b"],
    "term2": ["synonym2a", "synonym2b"]
  },
  "precisionQueries": ["\"term1\"", "\"term2\""],
  "broadQueries": [
    "(\"term1\" OR \"synonym1a\" OR \"synonym1b\") AND (\"term2\" OR \"synonym2a\")"
  ]
}

规则：
- 关键词必须是英文学术术语，即使用户输入中文
- 同义词要覆盖不同的表述方式（如 firm performance / corporate performance / organizational performance）
- 精准查询每个关键词加引号
- 广度查询用 OR 连接同义词组，用 AND 连接不同概念组
- 如果用户只输入了一个概念，广度查询用 OR 连接所有同义词即可`;

export async function buildSmartSearchPlan(
  input: string,
  provider: AIProvider = "gemini"
): Promise<SmartSearchPlan> {
  try {
    const response = await callAI({
      provider,
      system: EXTRACT_SYSTEM,
      messages: [{ role: "user", content: input }],
      jsonMode: true,
      temperature: 0.2,
    });

    return JSON.parse(response.content) as SmartSearchPlan;
  } catch {
    // Fallback: treat input as-is
    const terms = input
      .split(/[,，、;；和与and or OR]/)
      .map((t) => t.trim())
      .filter(Boolean);

    return {
      keyTerms: terms.length > 0 ? terms : [input],
      synonyms: {},
      precisionQueries: terms.map((t) => `"${t}"`),
      broadQueries: [input],
    };
  }
}

export async function smartSearch(
  input: string,
  provider: AIProvider = "gemini",
  limit: number = 20
): Promise<SmartSearchResult> {
  const startTime = Date.now();

  // Step 1-2: Extract terms + synonyms
  const plan = await buildSmartSearchPlan(input, provider);

  // Step 3: Precision search (each key term separately)
  const precisionPromises = plan.precisionQueries.slice(0, 3).map((q) =>
    searchAllSources({ query: q, limit }).catch(() => ({
      papers: [] as UnifiedPaper[],
      results: [],
    }))
  );

  // Step 4: Broad search (with synonyms)
  const broadPromises = plan.broadQueries.slice(0, 2).map((q) =>
    searchAllSources({ query: q, limit }).catch(() => ({
      papers: [] as UnifiedPaper[],
      results: [],
    }))
  );

  const allResults = await Promise.all([...precisionPromises, ...broadPromises]);

  // Step 5: Merge and deduplicate
  const seen = new Map<string, UnifiedPaper>();
  const byQuery: Record<string, number> = {};
  const allQueries = [...plan.precisionQueries.slice(0, 3), ...plan.broadQueries.slice(0, 2)];

  for (let i = 0; i < allResults.length; i++) {
    const result = allResults[i];
    const queryLabel = allQueries[i] ?? `query-${i}`;
    byQuery[queryLabel] = result.papers.length;

    for (const paper of result.papers) {
      const key =
        paper.doi?.toLowerCase() ||
        paper.title
          ?.toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fff]/g, "")
          .slice(0, 80);
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing || paper.citationCount > existing.citationCount) {
        seen.set(key, paper);
      }
    }
  }

  const papers = Array.from(seen.values()).sort(
    (a, b) => b.citationCount - a.citationCount
  );

  return {
    plan,
    papers,
    stats: {
      total: papers.length,
      byQuery,
      durationMs: Date.now() - startTime,
    },
  };
}
