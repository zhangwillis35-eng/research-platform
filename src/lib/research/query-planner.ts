/**
 * GPT-Researcher style query decomposition.
 * Takes a research topic and breaks it into sub-questions
 * for parallel multi-source search.
 */
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";

export interface ResearchPlan {
  mainQuestion: string;
  subQuestions: string[];
  searchQueries: {
    precision: string[]; // exact phrase queries
    broad: string[]; // natural language queries
  };
  perspectives: string[]; // STORM-style research perspectives
}

const PLANNER_SYSTEM = `你是一位管理学研究方法论专家。用户会给你一个研究主题，你需要：

1. 将主题分解为 3-5 个具体的研究子问题
2. 为每个子问题生成精准检索词（英文，用于 Semantic Scholar 等学术数据库）
3. 生成 2-3 个广度检索词（覆盖更多相关文献）
4. 识别 3-4 个研究视角（如：理论视角、实证方法视角、应用情境视角、批评/争议视角）

严格按以下 JSON 格式输出，不要输出其他内容：
{
  "mainQuestion": "核心研究问题（中文）",
  "subQuestions": ["子问题1", "子问题2", ...],
  "searchQueries": {
    "precision": ["exact phrase 1", "exact phrase 2", ...],
    "broad": ["broad query 1", "broad query 2", ...]
  },
  "perspectives": ["视角1：说明", "视角2：说明", ...]
}`;

export async function planResearch(
  topic: string,
  provider: AIProvider = "gemini"
): Promise<ResearchPlan> {
  const response = await callAI({
    provider,
    system: PLANNER_SYSTEM,
    messages: [{ role: "user", content: topic }],
    jsonMode: true,
    temperature: 0.3,
  });

  try {
    return JSON.parse(response.content) as ResearchPlan;
  } catch {
    // Fallback: generate basic plan
    return {
      mainQuestion: topic,
      subQuestions: [topic],
      searchQueries: {
        precision: [topic],
        broad: [topic],
      },
      perspectives: ["理论视角", "实证视角", "应用视角"],
    };
  }
}
