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

const PLANNER_SYSTEM = `You are a management research methodology expert. The user will provide a research topic. You need to:

1. Decompose the topic into 3-5 specific research sub-questions
2. Generate precise search terms in ENGLISH for each sub-question (for Semantic Scholar, Google Scholar, etc.)
3. Generate 2-3 broad search terms in ENGLISH for wider coverage
4. Identify 3-4 research perspectives (e.g., theoretical, empirical, applied, critical)

If the input is in Chinese, translate it to English first, then generate English search queries.
ALL search queries must be in English only. Chinese keywords are reserved for CNKI searches only — do NOT include any Chinese in searchQueries.

Output STRICT JSON only:
{
  "mainQuestion": "core research question (in Chinese)",
  "subQuestions": ["sub-question 1 in Chinese", ...],
  "searchQueries": {
    "precision": ["English exact phrase 1", "English exact phrase 2", ...],
    "broad": ["English broad query 1", "English broad query 2", ...]
  },
  "perspectives": ["perspective 1 (Chinese)", "perspective 2 (Chinese)", ...]
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
    noThinking: true,
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
