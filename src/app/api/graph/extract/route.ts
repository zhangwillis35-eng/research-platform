import { NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";

interface Paper {
  title: string;
  abstract?: string;
  authors?: { name: string }[];
  year?: number;
  venue?: string;
}

// ─── Step 1: Variable-level extraction ────────────
const GRAPH_SYSTEM = `你是管理学定量元分析(meta-analysis)专家。你的任务是从一组文献中系统性地提取所有变量间因果关系，并进行跨研究综合。

请像做 meta-analysis 编码一样，对每篇论文提取结构化数据。

输出严格 JSON：
{
  "nodes": [
    {
      "id": "变量名(英文)",
      "type": "IV|DV|MEDIATOR|MODERATOR|CONTROL",
      "frequency": 3,
      "aliases": ["同义变量1", "同义变量2"],
      "measurementApproaches": ["问卷Likert量表", "客观指标(ROA)"]
    }
  ],
  "edges": [
    {
      "source": "变量A",
      "target": "变量B",
      "type": "DIRECT|MEDIATION|MODERATION",
      "direction": "positive|negative|mixed|nonsignificant",
      "weight": 2,
      "papers": [1, 3],
      "findings": [
        {
          "paper": 1,
          "effect": "β=0.35, p<0.01",
          "sample": "中国制造业企业 N=320",
          "method": "hierarchical regression",
          "year": 2023
        }
      ],
      "consistency": "consistent|mostly_consistent|mixed|contradictory",
      "boundaryConditions": ["在高不确定性环境中更显著", "仅对大企业成立"],
      "evidenceStrength": "strong|moderate|weak|insufficient"
    }
  ],
  "metaSummary": {
    "fieldName": "该领域名称(中英文)",
    "coreFindings": [
      "发现1: X对Y有稳健的正向影响(k=5, 一致性高)",
      "发现2: M中介了X与Y的关系(k=3, 部分中介为主)"
    ],
    "theoreticalLandscape": [
      {
        "theory": "理论名称",
        "usage": "主要用于解释...",
        "paperCount": 4
      }
    ],
    "methodologicalProfile": {
      "dominantMethods": ["问卷调查", "档案数据"],
      "sampleContexts": ["中国企业", "美国上市公司"],
      "timeSpan": "2018-2025",
      "totalSampleSize": "约12000+"
    },
    "researchGaps": [
      {
        "gap": "缺乏纵向研究设计",
        "evidence": "全部8篇均为横截面设计",
        "importance": "high"
      }
    ],
    "emergingTrends": ["近年开始关注AI技术的调节作用", "跨层次分析增多"],
    "researchAgenda": [
      "未来方向1: 需要验证...",
      "未来方向2: 边界条件..."
    ],
    "maturityAssessment": "emerging|growing|maturing|mature",
    "maturityRationale": "该领域处于...阶段，因为..."
  }
}

元分析编码规则：
1. 变量名统一用英文，合并同义变量（如 firm performance / corporate performance → Firm Performance），并记录 aliases
2. 对每条边(关系)：
   - 逐篇提取 findings：效应量(β/r/d)、显著性、样本、方法、年份
   - 判断 consistency：多篇研究结果是否一致
   - 提取 boundaryConditions：在什么条件下关系成立/不成立
   - 评估 evidenceStrength：综合考虑研究数量、方法质量、一致性
3. direction 增加 nonsignificant（不显著），区分于 mixed（有正有负）
4. metaSummary 要全面深入：
   - coreFindings: 用 k=N 标注支持研究数量
   - theoreticalLandscape: 列出所有理论及使用情况
   - methodologicalProfile: 方法偏好、样本来源、时间跨度
   - researchGaps: 要有 evidence 支撑，不要空泛
   - maturityAssessment: 根据研究数量、理论深度、方法多样性判断领域成熟度`;

// ─── Step 2: Field landscape narrative ──────────
const LANDSCAPE_SYSTEM = `你是管理学领域的资深学者，擅长撰写系统性文献综述中的"研究全景分析"章节。

基于提供的变量关系图谱数据和元分析摘要，撰写一份全面的研究领域全景分析报告。

要求：
1. 用中文学术写作风格
2. 至少 1500 字，结构清晰
3. 必须包含以下板块（每个板块都要写充分）：

一、领域概述与研究脉络
- 该领域的核心研究问题是什么
- 研究是如何随时间演进的
- 目前处于什么发展阶段

二、核心变量关系网络
- 主要的因果路径有哪些（用 → 标注）
- 哪些关系已被多项研究稳健验证
- 哪些关系的发现存在分歧或矛盾
- 中介机制和调节条件的全貌

三、效应一致性与证据强度评估
- 对每个关键关系：支持研究数量、效应方向一致性、证据强度等级
- 类似 vote counting 方法的效应汇总
- 标注哪些结论可以视为"领域共识"，哪些仍有争议

四、理论图景
- 该领域使用了哪些理论视角
- 各理论的解释侧重点
- 理论整合的可能性

五、方法论特征
- 主流研究方法、数据来源
- 方法论偏好是否导致了系统性偏差
- 缺失的方法论视角

六、研究空白与未来议程
- 具体的、可操作的研究空白（不要泛泛而谈）
- 每个空白用证据支撑
- 建议的研究问题或假设

引用时用 [编号] 标注对应文献。`;

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { papers, provider = "gemini", nlmContext = "" } = body as {
      papers: Paper[];
      provider?: AIProvider;
      nlmContext?: string;
    };

    if (!papers?.length) {
      return NextResponse.json({ error: "Papers required" }, { status: 400 });
    }

    const content = papers
      .slice(0, 25)
      .map(
        (p, i) =>
          `[${i + 1}] ${p.title} (${p.year ?? "N/A"})${p.venue ? ` — ${p.venue}` : ""}\n${p.abstract ?? "(无摘要)"}`
      )
      .join("\n\n---\n\n");

    const fullContent = nlmContext
      ? `${content}\n\n===== NotebookLM 全文分析补充 =====\n${nlmContext}`
      : content;

    // Step 1: Extract structured graph + meta-summary
    const graphResponse = await callAI({
      provider,
      system: GRAPH_SYSTEM,
      messages: [{ role: "user", content: `以下是 ${papers.length} 篇文献，请进行元分析式编码和综合：\n\n${fullContent}` }],
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 8000,
    });

    let graph;
    try {
      graph = JSON.parse(graphResponse.content);
    } catch {
      return NextResponse.json({ nodes: [], edges: [], raw: graphResponse.content });
    }

    // Step 2: Generate field landscape narrative
    const graphSummaryForNarrative = JSON.stringify({
      nodes: graph.nodes?.slice(0, 30),
      edges: graph.edges?.slice(0, 40),
      metaSummary: graph.metaSummary,
    }, null, 2);

    const landscapeResponse = await callAI({
      provider,
      system: LANDSCAPE_SYSTEM,
      messages: [{
        role: "user",
        content: `原始文献（共 ${papers.length} 篇）：\n\n${content.slice(0, 6000)}\n\n元分析结果：\n${graphSummaryForNarrative}\n\n请基于以上信息，撰写研究领域全景分析报告。`,
      }],
      temperature: 0.3,
      maxTokens: 8000,
    });

    return NextResponse.json({
      ...graph,
      landscape: landscapeResponse.content,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Graph extraction failed", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 120;
