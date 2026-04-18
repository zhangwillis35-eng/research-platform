/**
 * NotebookLM integration layer.
 *
 * Two modes:
 * 1. Auto mode: calls local NotebookLM MCP proxy (localhost:27124)
 * 2. Manual mode: generates structured questions for user to ask in NotebookLM UI
 *
 * The MCP proxy is a lightweight Express server that forwards requests
 * to the NotebookLM MCP tool. Run locally with: npm run notebooklm-proxy
 */

export interface NotebookLMConfig {
  proxyUrl: string; // default: http://localhost:27124
  notebookId?: string;
  notebookUrl?: string;
  mode: "auto" | "manual";
}

export interface NotebookLMQuery {
  question: string;
  purpose: "review" | "variables" | "theories" | "gaps" | "ideas";
  context?: string; // additional context for the question
}

export interface NotebookLMResponse {
  answer: string;
  sessionId?: string;
  source: "notebooklm" | "fallback";
}

export interface NotebookLMStatus {
  available: boolean;
  mode: "auto" | "manual";
  notebookName?: string;
  error?: string;
}

const DEFAULT_PROXY_URL = "http://localhost:27125";

// ─── Connection Check ────────────────────────────

export async function checkNotebookLM(
  config: NotebookLMConfig
): Promise<NotebookLMStatus> {
  if (config.mode === "manual") {
    return { available: true, mode: "manual" };
  }

  try {
    const res = await fetch(`${config.proxyUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { available: false, mode: "auto", error: "代理服务未响应" };
    const data = await res.json();
    return {
      available: true,
      mode: "auto",
      notebookName: data.notebookName,
    };
  } catch {
    return {
      available: false,
      mode: "auto",
      error: "无法连接本地代理服务。请确认 notebooklm-proxy 正在运行，或切换到手动模式。",
    };
  }
}

// ─── Auto mode: query via proxy ──────────────────

async function queryViaProxy(
  config: NotebookLMConfig,
  query: NotebookLMQuery,
  sessionId?: string
): Promise<NotebookLMResponse> {
  const res = await fetch(`${config.proxyUrl}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: query.question,
      notebookId: config.notebookId,
      notebookUrl: config.notebookUrl,
      sessionId,
    }),
  });

  if (!res.ok) {
    throw new Error(`NotebookLM proxy error: ${res.status}`);
  }

  const data = await res.json();
  return {
    answer: data.answer ?? data.response ?? "",
    sessionId: data.sessionId,
    source: "notebooklm",
  };
}

// ─── Question generators for each research purpose ──

export function generateReviewQuestions(topic: string, paperCount: number): NotebookLMQuery[] {
  return [
    {
      question: `关于"${topic}"这个研究主题，这些文献的主要研究发现是什么？请按主题分类归纳，并标注每个发现来自哪篇文献。`,
      purpose: "review",
    },
    {
      question: `这些文献在研究"${topic}"时，研究方法和数据来源有哪些共同点和差异？哪些方法论选择可能影响了结论？`,
      purpose: "review",
    },
    {
      question: `关于"${topic}"，这${paperCount}篇文献中是否存在相互矛盾的结论？如果有，矛盾的原因可能是什么？`,
      purpose: "gaps",
    },
    {
      question: `基于这些文献，"${topic}"领域目前最大的研究空白（research gap）是什么？哪些问题尚未被充分探索？`,
      purpose: "gaps",
    },
  ];
}

export function generateVariableQuestions(topic: string): NotebookLMQuery[] {
  return [
    {
      question: `在这些关于"${topic}"的文献中，所有被研究的自变量（independent variables）有哪些？请逐一列出，并标注来自哪篇文献。`,
      purpose: "variables",
    },
    {
      question: `这些文献中的因变量（dependent variables）分别是什么？每个因变量是如何测量的？`,
      purpose: "variables",
    },
    {
      question: `这些文献中涉及了哪些中介变量（mediators）和调节变量（moderators）？它们的中介/调节效应是否显著？效应量多大？`,
      purpose: "variables",
    },
    {
      question: `这些研究使用了哪些控制变量？有哪些潜在的遗漏变量可能影响结论的稳健性？`,
      purpose: "variables",
    },
  ];
}

export function generateTheoryQuestions(topic: string): NotebookLMQuery[] {
  return [
    {
      question: `这些文献在研究"${topic}"时，分别使用了哪些理论框架？每个理论的核心假设是什么？`,
      purpose: "theories",
    },
    {
      question: `不同文献使用的理论框架之间有什么联系或冲突？是否有可能整合这些理论？`,
      purpose: "theories",
    },
    {
      question: `这些理论在什么边界条件下成立？有哪些文献挑战了现有理论的适用性？`,
      purpose: "theories",
    },
  ];
}

export function generateIdeaQuestions(topic: string): NotebookLMQuery[] {
  return [
    {
      question: `基于这些文献，"${topic}"领域还有哪些理论视角尚未被应用？哪些跨学科理论可能带来新洞见？`,
      purpose: "ideas",
    },
    {
      question: `这些研究主要在什么情境下进行的？哪些新兴情境（如数字化转型、ESG、AI应用）还未被充分研究？`,
      purpose: "ideas",
    },
    {
      question: `这些文献在研究方法上有什么局限？哪些新方法（如实验法、机器学习、fsQCA）可能产生新的发现？`,
      purpose: "ideas",
    },
  ];
}

// ─── Session-based deep analysis ─────────────────

export async function runDeepAnalysis(
  config: NotebookLMConfig,
  queries: NotebookLMQuery[]
): Promise<{ answers: NotebookLMResponse[]; sessionId?: string }> {
  if (config.mode === "manual") {
    // Return questions for manual mode
    return {
      answers: queries.map((q) => ({
        answer: `[手动模式] 请在 NotebookLM 中提问：\n\n${q.question}`,
        source: "fallback" as const,
      })),
    };
  }

  const answers: NotebookLMResponse[] = [];
  let sessionId: string | undefined;

  for (const query of queries) {
    try {
      const response = await queryViaProxy(config, query, sessionId);
      answers.push(response);
      sessionId = response.sessionId ?? sessionId;

      // Small delay between queries to respect NotebookLM rate limits
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      answers.push({
        answer: `[查询失败] ${String(err)}`,
        source: "fallback",
      });
    }
  }

  return { answers, sessionId };
}

// ─── Combine NotebookLM answers into structured context ──

export function combineAnswers(
  answers: NotebookLMResponse[],
  queries: NotebookLMQuery[]
): string {
  return answers
    .map((a, i) => {
      const query = queries[i];
      const label = {
        review: "文献综述分析",
        variables: "变量关系分析",
        theories: "理论框架分析",
        gaps: "研究空白分析",
        ideas: "研究方向分析",
      }[query?.purpose ?? "review"];

      return `### ${label}\n\n**问题**: ${query?.question}\n\n**NotebookLM 回答**:\n${a.answer}`;
    })
    .join("\n\n---\n\n");
}

export { DEFAULT_PROXY_URL };
