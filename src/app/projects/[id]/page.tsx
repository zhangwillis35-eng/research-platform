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

      {/* Stats */}
      <div className="grid grid-cols-4 gap-6">
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
      <div>
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

      {/* External services & compatibility */}
      <div className="space-y-6">
        <h2 className="font-heading text-lg font-semibold">
          外接服务与网络兼容性
        </h2>

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
              { name: "Google Gemini 3.x", desc: "Google 多模态模型", ok: false },
              { name: "OpenAI GPT-4o", desc: "OpenAI 旗舰模型", ok: false },
              { name: "Anthropic Claude Sonnet 4", desc: "结构化输出与长文本", ok: false },
            ] as const).map((m) => (
              <div key={m.name} className="flex items-center gap-2 text-xs py-1">
                <span className={`shrink-0 w-4 text-center ${m.ok ? "text-green-500" : "text-amber-500"}`}>
                  {m.ok ? "\u2713" : "\u0021"}
                </span>
                <span className="font-medium text-foreground/90">{m.name}</span>
                <span className="text-muted-foreground hidden sm:inline">- {m.desc}</span>
                {!m.ok && (
                  <span className="ml-auto text-[10px] text-amber-500 border border-amber-300/50 rounded px-1.5 py-0.5 shrink-0">
                    需代理
                  </span>
                )}
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
              { name: "Serper.dev", desc: "Google Scholar 主检索", ok: false },
              { name: "SerpAPI", desc: "Google Scholar 备用检索", ok: false },
              { name: "Web of Science", desc: "WoS 顶刊论文", ok: false },
            ] as const).map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-xs py-1">
                <span className={`shrink-0 w-4 text-center ${s.ok ? "text-green-500" : "text-amber-500"}`}>
                  {s.ok ? "\u2713" : "\u0021"}
                </span>
                <span className="font-medium text-foreground/90">{s.name}</span>
                <span className="text-muted-foreground hidden sm:inline">- {s.desc}</span>
                {!s.ok && (
                  <span className="ml-auto text-[10px] text-amber-500 border border-amber-300/50 rounded px-1.5 py-0.5 shrink-0">
                    需代理
                  </span>
                )}
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
              { name: "Europe PMC / PubMed", desc: "生物医学全文获取", ok: false },
            ] as const).map((i) => (
              <div key={i.name} className="flex items-center gap-2 text-xs py-1">
                <span className={`shrink-0 w-4 text-center ${i.ok ? "text-green-500" : "text-amber-500"}`}>
                  {i.ok ? "\u2713" : "\u0021"}
                </span>
                <span className="font-medium text-foreground/90">{i.name}</span>
                <span className="text-muted-foreground hidden sm:inline">- {i.desc}</span>
                {!i.ok && (
                  <span className="ml-auto text-[10px] text-amber-500 border border-amber-300/50 rounded px-1.5 py-0.5 shrink-0">
                    需代理
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Mainland China without proxy */}
        <div className="rounded-lg border border-amber-200/60 bg-amber-50/30 dark:bg-amber-950/10 dark:border-amber-800/30 px-5 py-4 space-y-3">
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            没有代理的大陆用户须知
          </h3>
          <div className="text-xs text-amber-800/80 dark:text-amber-300/70 space-y-2 leading-relaxed">
            <p>
              <span className="font-semibold">AI 模型：</span>仅可使用 DeepSeek 系列（V4 Flash、V4 Pro、R1）。
              Gemini、GPT-4o、Claude 均无法连接。
              <span className="text-muted-foreground"> DeepSeek 已设为默认模型，完整覆盖所有功能。</span>
            </p>
            <p>
              <span className="font-semibold">文献检索：</span>Google Scholar（Serper/SerpAPI）不可用，
              但 Semantic Scholar、OpenAlex、arXiv、CORE 等 6 个免费源正常工作，
              仍可检索到大量英文文献。
            </p>
            <p>
              <span className="font-semibold">全文获取：</span>Europe PMC、PubMed Central 等海外全文源可能受限，
              但 Unpaywall、CrossRef、CORE、Semantic Scholar 的开放获取链接仍可正常使用。
              建议通过校园网 EZproxy 或上传 PDF 获取全文。
            </p>
            <p>
              <span className="font-semibold">完全不受影响的功能：</span>文献库管理、PDF 上传与解析、AI 分析（DeepSeek）、
              知识图谱、文献综述、研究想法、理论整合、参考文献导出、邀请码注册。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
