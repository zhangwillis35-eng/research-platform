import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function ProjectOverview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetch real stats from database
  const [paperCount, selectedCount, ideaCount, nodeCount, uploadedCount] =
    await Promise.all([
      prisma.paper.count({ where: { projectId: id } }),
      prisma.paper.count({ where: { projectId: id, isSelected: true } }),
      prisma.researchIdea.count({ where: { projectId: id } }),
      prisma.graphNode.count({ where: { projectId: id } }),
      prisma.paper.count({ where: { projectId: id, fullText: { not: null } } }),
    ]);

  const stats = [
    { label: "文献总数", value: paperCount, color: "text-teal" },
    { label: "已上传原文", value: uploadedCount, color: "text-teal" },
    { label: "研究想法", value: ideaCount, color: "text-foreground" },
    { label: "图谱节点", value: nodeCount, color: "text-foreground" },
  ];

  const steps = [
    { num: "1", text: "前往「文献检索」搜索相关文献", href: "/papers/search" },
    { num: "2", text: "在「文献库」中上传 PDF 文献原文", href: "/papers" },
    { num: "3", text: "使用「文献综述」生成结构化综述", href: "/review/generate" },
    { num: "4", text: "使用「知识图谱」可视化变量关系", href: "/graph" },
    { num: "5", text: "通过「研究想法」生成新的研究方向", href: "/ideas/generate" },
    { num: "6", text: "生成「参考文献」列表（APA/MLA/BibTeX）", href: "/references" },
  ];

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-heading text-2xl font-bold">
          项目概览
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          查看研究项目的整体进展
        </p>
      </div>

      {/* Internal navigation pane */}
      <nav className="flex gap-4 border-b border-border/50 pb-3 mb-6 text-sm">
        <a href="#stats" className="text-muted-foreground hover:text-teal transition-colors">数据统计</a>
        <a href="#quickstart" className="text-muted-foreground hover:text-teal transition-colors">快速开始</a>
        <a href="#services" className="text-muted-foreground hover:text-teal transition-colors">外接服务</a>
        <a href="#tools" className="text-muted-foreground hover:text-teal transition-colors">外部工具</a>
        <a href="#network" className="text-muted-foreground hover:text-teal transition-colors">网络兼容性</a>
      </nav>

      {/* Stats */}
      <div id="stats" className="grid grid-cols-4 gap-6">
        {stats.map((s) => (
          <div key={s.label} className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {s.label}
            </p>
            <p className={`text-3xl font-bold tabular-nums ${s.color}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <hr className="border-border/50" />

      {/* Quick start */}
      <div id="quickstart">
        <h2 className="font-heading text-lg font-semibold mb-4">
          快速开始
        </h2>
        <div className="space-y-3">
          {steps.map((step) => (
            <div key={step.num} className="flex items-baseline gap-4 group">
              <span className="text-sm font-bold text-teal w-5 shrink-0">
                {step.num}
              </span>
              <Link
                href={`/projects/${id}${step.href}`}
                className="text-sm text-muted-foreground group-hover:text-foreground transition-colors"
              >
                {step.text}
              </Link>
            </div>
          ))}
        </div>
      </div>

      <hr className="border-border/50" />

      {/* External Tools & Network — side by side */}
      <div className="grid sm:grid-cols-2 gap-8">
        {/* External Tools */}
        <div id="tools">
          <h2 className="font-heading text-lg font-semibold mb-4">外部工具集成</h2>
          <div className="space-y-3">
            {[
              { name: "Zotero", desc: "文献管理同步，自动导入检索结果", icon: "📚" },
              { name: "Obsidian", desc: "笔记推送，Markdown 格式导出", icon: "📝" },
              { name: "Stanford STORM", desc: "文献综述引擎，多轮对话深度分析", icon: "⚡" },
              { name: "GROBID", desc: "ML 结构化 PDF 解析（标题/摘要/章节/参考文献）", icon: "📄" },
              { name: "SPECTER2", desc: "Allen AI 语义嵌入，论文相似度搜索", icon: "🔍" },
              { name: "GLiNER", desc: "零样本变量关系抽取，自动识别 IV/DV/中介/调节", icon: "🧬" },
              { name: "LightRAG", desc: "跨论文知识图谱查询，基于图证据回答研究问题", icon: "🕸️" },
            ].map((tool) => (
              <div key={tool.name} className="flex items-start gap-3 text-sm">
                <span className="text-base">{tool.icon}</span>
                <div>
                  <span className="font-medium">{tool.name}</span>
                  <span className="text-muted-foreground ml-2">{tool.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Network Compatibility */}
        <div id="network">
          <h2 className="font-heading text-lg font-semibold mb-4">网络兼容性</h2>
          <div className="rounded-lg border border-green-200/60 bg-green-50/30 px-4 py-3">
            <p className="text-sm text-green-700 font-medium mb-2">✓ 服务器部署在香港，所有外部服务均可直接访问</p>
            <p className="text-xs text-muted-foreground">AI 模型（DeepSeek / GPT-4o / Gemini / Claude）、学术数据源（Google Scholar / PubMed / WoS）、全文获取（Europe PMC / Unpaywall）等全部正常可用，无需配置代理。</p>
          </div>
        </div>
      </div>

      <hr className="border-border/50" />

      {/* External services — collapsible details */}
      <details id="services" className="border border-border/50 rounded-lg">
        <summary className="px-4 py-3 cursor-pointer text-sm font-semibold hover:bg-muted/50 transition-colors">
          外接服务详情（AI 模型 · 学术检索源 · 基础设施）
        </summary>
        <div className="px-4 pb-4 space-y-6">
          {/* AI Models */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-teal inline-block" />
              AI 大语言模型
            </h3>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 pl-4">
              {([
                { name: "DeepSeek V4 Flash / Pro", desc: "默认模型，结构化提取与深度分析", ok: true },
                { name: "DeepSeek R1", desc: "深度推理模型", ok: true },
                { name: "Google Gemini 3.x", desc: "Google 多模态模型", ok: true },
                { name: "OpenAI GPT-4o", desc: "OpenAI 旗舰模型", ok: true },
                { name: "Anthropic Claude Sonnet 4", desc: "结构化输出与长文本", ok: true },
              ] as const).map((m) => (
                <div key={m.name} className="flex items-center gap-2 text-xs py-1">
                  <span className="shrink-0 w-4 text-center text-green-500">
                    ✓
                  </span>
                  <span className="font-medium text-foreground/90">{m.name}</span>
                  <span className="text-muted-foreground hidden sm:inline">- {m.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Academic Search Sources */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
              学术检索源
            </h3>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 pl-4">
              {([
                { name: "Semantic Scholar", desc: "论文元数据与引用网络", ok: true },
                { name: "OpenAlex", desc: "开放获取论文搜索", ok: true },
                { name: "arXiv", desc: "预印本论文", ok: true },
                { name: "CrossRef", desc: "DOI 元数据查询", ok: true },
                { name: "CORE.ac.uk", desc: "开放获取聚合器", ok: true },
                { name: "Unpaywall", desc: "免费全文获取", ok: true },
                { name: "Serper.dev", desc: "Google Scholar 主检索", ok: true },
                { name: "SerpAPI", desc: "Google Scholar 备用检索", ok: true },
                { name: "Web of Science", desc: "WoS 顶刊论文", ok: true },
                { name: "PubMed", desc: "生物医学文献数据库", ok: true },
                { name: "DBLP", desc: "计算机科学文献索引", ok: true },
                { name: "bioRxiv", desc: "生物学预印本论文", ok: true },
              ] as const).map((s) => (
                <div key={s.name} className="flex items-center gap-2 text-xs py-1">
                  <span className="shrink-0 w-4 text-center text-green-500">
                    ✓
                  </span>
                  <span className="font-medium text-foreground/90">{s.name}</span>
                  <span className="text-muted-foreground hidden sm:inline">- {s.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Infrastructure */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block" />
              基础设施与工具
            </h3>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 pl-4">
              {([
                { name: "PostgreSQL (Neon)", desc: "云数据库", ok: true },
                { name: "阿里云 OSS", desc: "PDF 文件存储", ok: true },
                { name: "QQ 邮箱 SMTP", desc: "邀请码邮件发送", ok: true },
                { name: "Stanford STORM", desc: "文献综述分析引擎", ok: true },
                { name: "EZproxy (校园网)", desc: "机构全文获取代理", ok: true },
                { name: "Europe PMC / PubMed", desc: "生物医学全文获取", ok: true },
                { name: "GROBID", desc: "ML 结构化 PDF 全文解析", ok: true },
                { name: "SPECTER2", desc: "Allen AI 语义嵌入模型", ok: true },
              ] as const).map((i) => (
                <div key={i.name} className="flex items-center gap-2 text-xs py-1">
                  <span className="shrink-0 w-4 text-center text-green-500">
                    ✓
                  </span>
                  <span className="font-medium text-foreground/90">{i.name}</span>
                  <span className="text-muted-foreground hidden sm:inline">- {i.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
