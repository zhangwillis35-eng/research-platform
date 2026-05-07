import Link from "next/link";
import { Button } from "@/components/ui/button";

// ─── Workflow Steps ──────────────────────────────
const workflow = [
  {
    step: "01",
    title: "智能文献检索",
    subtitle: "多源聚合 · 三级筛选 · 逐篇分析",
    description: "11 源并行检索，8 维语义关键词扩展，三级优先级筛选（顶刊 → 高引 → 前沿），每篇论文独立 AI 分析。",
    details: [
      "Google Scholar + Semantic Scholar + OpenAlex + arXiv + CORE 等 11 源聚合",
      "检索规则：顶刊（Nature/Science、ABS 3*+、JCR Q1）永远优先；非顶刊按年份动态引用阈值筛选；arXiv 仅保留当年有引用的前沿论文",
      "8 维语义关键词扩展：覆盖直接同义、上下位概念、相邻研究流、顶刊术语、因果机制等",
      "SPECTER2 语义重排序 + AI 逐篇独立评分与分析",
    ],
  },
  {
    step: "02",
    title: "文献综述生成",
    subtitle: "STORM 驱动 · 多视角架构 · 逐段精修",
    description: "基于 Stanford STORM 引擎的多视角大纲生成 → 章节并行撰写 → 融合润色 → 逐段 AI 精修。",
    details: [
      "STORM 多视角大纲：从理论、实证、应用、批判四个视角结构化分析文献",
      "全文 AI 编辑器：顶部全局对话框 + 每段独立 AI 微调，所有编辑共享完整上下文",
      "用户自定义字数范围（6000-50000 字），LLM 按比例分配章节篇幅",
      "APA 文内引用 + 完整参考文献列表，严格遵循学术写作规范",
    ],
  },
  {
    step: "03",
    title: "综述智能优化",
    subtitle: "上传初稿 · 缺口检测 · 双轨修改",
    description: "上传 Word 初稿 → AI 结构分析 → 检索补充文献 → 覆盖缺口分组 → 用户勾选 → 双轨修改计划。",
    details: [
      "AI 分析初稿结构、引用密度、薄弱环节，自动提取检索方向供用户勾选",
      "按覆盖缺口分组推荐文献：每个缺口下挂相关论文，用户按需勾选采纳",
      "「已有内容改进」+「方向扩展延伸」双轨修改计划，完全由用户决策",
      "新增文献篮自动联动修改篮，修改后可逐段 AI 精修",
    ],
  },
  {
    step: "04",
    title: "知识图谱",
    subtitle: "变量提取 · 力导向图 · 元分析",
    description: "从全文中提取 IV → Mediator → Moderator → DV 关系网络，D3 力导向图可视化，全景分析报告。",
    details: [
      "自动识别自变量、因变量、中介、调节、控制变量及其关系",
      "D3 力导向图交互式可视化，支持子图筛选与节点探索",
      "元分析证据表：汇总每条关系的研究数量、效应方向和一致性",
      "领域全景报告：研究成熟度评估、理论框架梳理、研究空白识别",
    ],
  },
  {
    step: "05",
    title: "研究想法 & 理论整合",
    subtitle: "维度矩阵 · 同行评审 · 概念模型",
    description: "理论 x 情境 x 方法 组合矩阵生成创新想法，AI 同行评审，跨理论框架融合生成概念模型。",
    details: [
      "从文献中自动提取理论、情境、方法维度，组合发现创新研究空白",
      "AI 模拟 3 位审稿人进行同行评审，评估新颖性、可行性与贡献",
      "跨理论框架整合，自动生成概念模型图",
      "一键生成 Proposal 框架（研究问题、假设、方法论）",
    ],
  },
];

// ─── Highlights ──────────────────────────────────
const highlights = [
  { icon: "mag", label: "三级优先级筛选", desc: "顶刊永远优先 → 高引动态阈值 → 前沿 arXiv" },
  { icon: "key", label: "8 维语义扩展", desc: "同义词、上下位、相邻流、顶刊术语、因果、测量等全覆盖" },
  { icon: "pen", label: "逐段 AI 精修", desc: "全文编辑 + 每段独立对话框，上下文完全互通" },
  { icon: "git", label: "双轨修改计划", desc: "已有内容改进 + 方向扩展延伸，用户完全掌控" },
  { icon: "db", label: "覆盖缺口分组", desc: "文献按缺口归类推荐，勾选缺口 → 勾选论文 → 生成计划" },
  { icon: "zap", label: "STORM 分析引擎", desc: "Stanford STORM 多视角深度分析，NotebookLM 可选集成" },
];

const iconMap: Record<string, string> = {
  mag: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  zap: "M13 2L3 14h9l-1 10 10-12h-9l1-10z",
  pen: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7",
  git: "M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6z",
  key: "M15 7h3a5 5 0 015 5 5 5 0 01-5 5h-3m-6 0H6a5 5 0 010-10h3",
  db: "M12 2C6.48 2 2 4.24 2 7v10c0 2.76 4.48 5 10 5s10-2.24 10-5V7c0-2.76-4.48-5-10-5z",
};

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* ═══ Nav ═══ */}
      <header className="fixed top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto flex h-14 items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-xs font-bold">S</span>
            </div>
            <span className="font-heading text-lg font-bold tracking-tight">ScholarFlow</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/projects">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">我的项目</Button>
            </Link>
            <Link href="/login">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">登录</Button>
            </Link>
            <Link href="/projects/new">
              <Button size="sm" className="bg-teal text-teal-foreground hover:bg-teal/90">开始使用</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 pt-14">
        {/* ═══ Hero ═══ */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-teal/5 via-transparent to-primary/5 pointer-events-none" />
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute w-2 h-2 rounded-full bg-teal/20 animate-float-1 top-[20%] left-[10%]" />
            <div className="absolute w-3 h-3 rounded-full bg-primary/15 animate-float-2 top-[40%] right-[15%]" />
            <div className="absolute w-1.5 h-1.5 rounded-full bg-teal/25 animate-float-3 top-[60%] left-[25%]" />
            <div className="absolute w-2 h-2 rounded-full bg-primary/20 animate-float-1 top-[30%] right-[30%]" />
            <div className="absolute w-1 h-1 rounded-full bg-teal/30 animate-float-2 top-[70%] left-[60%]" />
          </div>

          <div className="max-w-6xl mx-auto px-6 pt-24 pb-20 relative">
            <div className="max-w-3xl animate-fade-up">
              <p className="text-sm font-medium text-teal tracking-wide uppercase mb-4">
                AI-Powered Academic Research Platform
              </p>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight">
                从领域结构到研究设计
                <br />
                <span className="bg-gradient-to-r from-teal via-primary to-teal bg-clip-text text-transparent animate-shimmer">
                  全流程 AI 赋能
                </span>
              </h1>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl">
                ScholarFlow 用三级期刊优先级筛选 + 8 维语义关键词扩展 + 逐篇独立 AI 分析，
                赋能管理学研究者完成从文献整理、知识图谱到想法生成与理论整合的完整工作流。
              </p>
              <div className="mt-10 flex items-center gap-4">
                <Link href="/projects/new">
                  <Button size="lg" className="bg-teal text-teal-foreground hover:bg-teal/90 h-12 px-8 text-base shadow-lg shadow-teal/20">
                    创建研究项目
                  </Button>
                </Link>
                <Link href="/projects">
                  <Button variant="outline" size="lg" className="h-12 px-8 text-base">浏览项目</Button>
                </Link>
              </div>
            </div>

            {/* Animated workflow preview */}
            <div className="mt-16 animate-fade-up" style={{ animationDelay: "200ms" }}>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {workflow.map((w, i) => (
                  <div key={w.step} className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-border/40 bg-muted/30 animate-pulse-subtle" style={{ animationDelay: `${i * 400}ms` }}>
                      <div className="w-2 h-2 rounded-full bg-teal/60" />
                      <span className="text-xs font-medium text-foreground/70 whitespace-nowrap">{w.title}</span>
                    </div>
                    {i < workflow.length - 1 && (
                      <svg className="w-4 h-4 text-border shrink-0" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ Workflow Steps ═══ */}
        <section className="border-t border-border/30">
          <div className="max-w-6xl mx-auto px-6 py-20">
            <div className="text-center mb-16 animate-fade-up">
              <h2 className="font-heading text-3xl font-bold tracking-tight">完整研究工作流</h2>
              <p className="mt-3 text-muted-foreground max-w-xl mx-auto">每一步都经过深度优化 — 从关键词提取到最终综述，全程可控、可追溯</p>
            </div>

            <div className="stagger-children space-y-4">
              {workflow.map((w) => (
                <div key={w.step} className="animate-fade-up group">
                  <div className="rounded-xl border border-border/40 bg-card/50 p-6 transition-all duration-300 hover:border-teal/20 hover:shadow-md hover:shadow-teal/5">
                    <div className="flex items-start gap-6">
                      <div className="text-4xl font-heading font-bold text-border/40 group-hover:text-teal/30 transition-colors shrink-0">
                        {w.step}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="text-xl font-semibold tracking-tight group-hover:text-teal transition-colors">{w.title}</h3>
                          <span className="text-[11px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">{w.subtitle}</span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{w.description}</p>
                        <div className="mt-4 grid sm:grid-cols-2 gap-2">
                          {w.details.map((d, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-foreground/60">
                              <div className="w-1 h-1 rounded-full bg-teal/40 mt-1.5 shrink-0" />
                              {d}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ Highlights Grid ═══ */}
        <section className="border-t border-border/30">
          <div className="max-w-6xl mx-auto px-6 py-20">
            <div className="text-center mb-12 animate-fade-up">
              <h2 className="font-heading text-3xl font-bold tracking-tight">核心亮点</h2>
              <p className="mt-3 text-muted-foreground">每个细节都为科研效率而设计</p>
            </div>
            <div className="stagger-children grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {highlights.map((h) => (
                <div key={h.label} className="animate-fade-up group rounded-xl border border-border/40 p-5 hover:border-teal/25 hover:bg-teal/[0.015] transition-all duration-300">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-teal/70 shrink-0 mt-0.5 group-hover:text-teal group-hover:scale-110 transition-all" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={iconMap[h.icon]} />
                    </svg>
                    <div>
                      <h3 className="font-semibold text-sm">{h.label}</h3>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{h.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ Models strip ═══ */}
        <section className="bg-primary text-primary-foreground">
          <div className="max-w-6xl mx-auto px-6 py-12">
            <p className="text-sm uppercase tracking-wide text-primary-foreground/60 mb-6">多模型自由切换</p>
            <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { name: "DeepSeek V4", tag: "Flash / Pro / R1" },
                { name: "GPT-4o", tag: "OpenAI" },
                { name: "Claude 4", tag: "Anthropic" },
                { name: "Gemini 3.x", tag: "Google" },
                { name: "Qwen Plus", tag: "Alibaba" },
                { name: "GLM-4", tag: "Zhipu" },
              ].map((m) => (
                <div key={m.name} className="flex flex-col">
                  <span className="text-base font-medium">{m.name}</span>
                  <span className="text-xs text-primary-foreground/50">{m.tag}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ CTA ═══ */}
        <section className="border-t border-border/30">
          <div className="max-w-6xl mx-auto px-6 py-20 text-center">
            <h2 className="font-heading text-3xl font-bold tracking-tight animate-fade-up">开始你的研究</h2>
            <p className="mt-4 text-muted-foreground max-w-lg mx-auto animate-fade-up" style={{ animationDelay: "100ms" }}>
              创建一个项目，上传文献 PDF，让 ScholarFlow 帮你完成从文献检索到综述写作的全流程。
            </p>
            <div className="mt-8 animate-fade-up" style={{ animationDelay: "200ms" }}>
              <Link href="/projects/new">
                <Button size="lg" className="bg-teal text-teal-foreground hover:bg-teal/90 h-12 px-10 text-base shadow-lg shadow-teal/20">
                  创建研究项目
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ═══ Footer ═══ */}
      <footer className="border-t py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-heading">ScholarFlow</span>
          <div className="flex items-center gap-4">
            <Link href="/help" className="hover:text-foreground transition-colors">网络兼容性说明</Link>
            <span>Powered by Stanford STORM & DeepSeek</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
