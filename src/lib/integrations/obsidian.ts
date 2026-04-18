/**
 * Obsidian Local REST API integration.
 *
 * Requires user to install "Local REST API" plugin in Obsidian:
 * https://github.com/coddingtonbear/obsidian-local-rest-api
 *
 * Default endpoint: http://127.0.0.1:27123
 * Auth: Bearer token (configured in plugin settings)
 *
 * Two-way integration:
 * 1. Read: Pull user notes as idea seeds
 * 2. Write: Push research results to vault
 */

export interface ObsidianConfig {
  baseUrl: string; // default: http://127.0.0.1:27123
  apiKey: string;  // Bearer token from plugin
}

export interface ObsidianNote {
  path: string;
  content: string;
  tags?: string[];
  frontmatter?: Record<string, unknown>;
}

export interface ObsidianStatus {
  connected: boolean;
  vaultName?: string;
  error?: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:27123";

function headers(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

// ─── Connection Check ────────────────────────────

export async function checkConnection(
  config: ObsidianConfig
): Promise<ObsidianStatus> {
  try {
    const res = await fetch(`${config.baseUrl}/`, {
      headers: headers(config.apiKey),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return { connected: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return {
      connected: true,
      vaultName: data.service ?? "Obsidian Vault",
    };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error && err.name === "TimeoutError"
        ? "连接超时 — 请确认 Obsidian 已启动且 Local REST API 插件已开启"
        : "无法连接 — 请确认 Obsidian 运行在本地",
    };
  }
}

// ─── Read: Search & pull notes ───────────────────

export async function searchNotes(
  config: ObsidianConfig,
  query: string
): Promise<ObsidianNote[]> {
  const res = await fetch(
    `${config.baseUrl}/search/simple/?query=${encodeURIComponent(query)}`,
    { headers: headers(config.apiKey) }
  );

  if (!res.ok) throw new Error(`Obsidian search failed: ${res.status}`);

  const results = await res.json();
  return (results ?? []).map((r: { filename: string; matches: Array<{ context: string }> }) => ({
    path: r.filename,
    content: r.matches?.map((m: { context: string }) => m.context).join("\n") ?? "",
  }));
}

export async function readNote(
  config: ObsidianConfig,
  path: string
): Promise<string> {
  const res = await fetch(
    `${config.baseUrl}/vault/${encodeURIComponent(path)}`,
    {
      headers: {
        ...headers(config.apiKey),
        Accept: "text/markdown",
      },
    }
  );

  if (!res.ok) throw new Error(`Failed to read note: ${res.status}`);
  return res.text();
}

export async function listNotesByTag(
  config: ObsidianConfig,
  tag: string
): Promise<string[]> {
  // Search for notes containing the tag
  const res = await fetch(
    `${config.baseUrl}/search/simple/?query=${encodeURIComponent(`#${tag}`)}`,
    { headers: headers(config.apiKey) }
  );

  if (!res.ok) return [];
  const results = await res.json();
  return (results ?? []).map((r: { filename: string }) => r.filename);
}

// ─── Write: Push results to vault ────────────────

export async function writeNote(
  config: ObsidianConfig,
  path: string,
  content: string
): Promise<boolean> {
  const res = await fetch(
    `${config.baseUrl}/vault/${encodeURIComponent(path)}`,
    {
      method: "PUT",
      headers: {
        ...headers(config.apiKey),
        "Content-Type": "text/markdown",
      },
      body: content,
    }
  );

  return res.ok;
}

export async function appendToNote(
  config: ObsidianConfig,
  path: string,
  content: string
): Promise<boolean> {
  const res = await fetch(
    `${config.baseUrl}/vault/${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: {
        ...headers(config.apiKey),
        "Content-Type": "text/markdown",
      },
      body: content,
    }
  );

  return res.ok;
}

// ─── High-level: Push research idea to Obsidian ──

export interface ResearchIdeaForObsidian {
  title: string;
  theory: string;
  context: string;
  method: string;
  hypothesis: string;
  contribution: string;
  scores: { novelty: number; feasibility: number; impact: number; overall: number };
  peerReview?: {
    strengths: string[];
    weaknesses: string[];
    questions: string[];
    verdict: string;
  };
  relatedPapers?: string[];
}

export async function pushIdeaToObsidian(
  config: ObsidianConfig,
  idea: ResearchIdeaForObsidian,
  folder: string = "ScholarFlow/Ideas"
): Promise<boolean> {
  const filename = idea.title.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
  const path = `${folder}/${filename}.md`;

  const content = `---
title: "${idea.title}"
theory: "${idea.theory}"
context: "${idea.context}"
method: "${idea.method}"
novelty: ${idea.scores.novelty}
feasibility: ${idea.scores.feasibility}
impact: ${idea.scores.impact}
overall: ${idea.scores.overall}
source: ScholarFlow
created: ${new Date().toISOString().split("T")[0]}
tags:
  - research-idea
  - ${idea.theory.split(":")[0]?.trim().toLowerCase().replace(/\s+/g, "-") ?? "theory"}
---

# ${idea.title}

## 研究设计
- **理论基础**: ${idea.theory}
- **研究情境**: ${idea.context}
- **研究方法**: ${idea.method}

## 核心假设
${idea.hypothesis}

## 预期贡献
${idea.contribution}

## 评分
| 维度 | 分数 |
|------|------|
| 新颖性 | ${idea.scores.novelty}/10 |
| 可行性 | ${idea.scores.feasibility}/10 |
| 影响力 | ${idea.scores.impact}/10 |
| **综合** | **${idea.scores.overall}/10** |

${idea.peerReview ? `## 模拟同行评审

### 优点
${idea.peerReview.strengths.map((s) => `- ${s}`).join("\n")}

### 不足
${idea.peerReview.weaknesses.map((w) => `- ${w}`).join("\n")}

### 审稿人问题
${idea.peerReview.questions.map((q) => `- ${q}`).join("\n")}

### 评审意见: **${idea.peerReview.verdict}**
` : ""}
${idea.relatedPapers?.length ? `## 相关文献
${idea.relatedPapers.map((p) => `- ${p}`).join("\n")}` : ""}

---
*Generated by [[ScholarFlow]] on ${new Date().toISOString().split("T")[0]}*
`;

  return writeNote(config, path, content);
}

// ─── High-level: Push literature note to Obsidian ──

export interface PaperForObsidian {
  title: string;
  authors: string;
  year?: number;
  venue?: string;
  doi?: string;
  abstract?: string;
  rankings?: string[];
  variables?: string;
}

export async function pushPaperToObsidian(
  config: ObsidianConfig,
  paper: PaperForObsidian,
  folder: string = "ScholarFlow/Papers"
): Promise<boolean> {
  const filename = paper.title.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
  const path = `${folder}/${filename}.md`;

  const content = `---
title: "${paper.title}"
authors: "${paper.authors}"
year: ${paper.year ?? "unknown"}
venue: "${paper.venue ?? ""}"
doi: "${paper.doi ?? ""}"
rankings: [${(paper.rankings ?? []).map((r) => `"${r}"`).join(", ")}]
source: ScholarFlow
tags:
  - paper
  - literature
---

# ${paper.title}

**${paper.authors}** (${paper.year ?? "N/A"})
${paper.venue ? `*${paper.venue}*` : ""}${paper.rankings?.length ? ` | ${paper.rankings.join(" / ")}` : ""}
${paper.doi ? `DOI: [${paper.doi}](https://doi.org/${paper.doi})` : ""}

## 摘要
${paper.abstract ?? "_No abstract available_"}

${paper.variables ? `## 变量关系\n${paper.variables}` : ""}

## 笔记
_在此添加你的阅读笔记..._

---
*Imported by [[ScholarFlow]] on ${new Date().toISOString().split("T")[0]}*
`;

  return writeNote(config, path, content);
}

// ─── High-level: Pull idea seeds from Obsidian ──

export async function pullIdeaSeeds(
  config: ObsidianConfig,
  tags: string[] = ["research-idea", "research", "thesis"]
): Promise<string[]> {
  const allNotes: string[] = [];

  for (const tag of tags) {
    const paths = await listNotesByTag(config, tag);
    for (const path of paths.slice(0, 10)) {
      try {
        const content = await readNote(config, path);
        // Extract key sentences (frontmatter + first 500 chars)
        const trimmed = content.slice(0, 500);
        allNotes.push(`[${path}]\n${trimmed}`);
      } catch {
        // skip unreadable notes
      }
    }
  }

  return allNotes;
}

export { DEFAULT_BASE_URL };
