import Link from "next/link";
import { Button } from "@/components/ui/button";

const features = [
  {
    title: "智能文献检索",
    description:
      "多源聚合 Semantic Scholar、OpenAlex、Google Scholar，自动去重，按引用量排序",
    number: "01",
  },
  {
    title: "AI 文献综述",
    description:
      "NotebookLM 全文 RAG 分析 + 四大模型结构化输出，生成有引用溯源的综述",
    number: "02",
  },
  {
    title: "变量关系图谱",
    description:
      "从文献中自动提取 IV → Mediator → DV 关系，D3 力导向图可视化",
    number: "03",
  },
  {
    title: "研究想法生成",
    description:
      "理论 × 情境 × 方法 组合矩阵，AI 评估新颖性、可行性与学术贡献",
    number: "04",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <header className="fixed top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto flex h-14 items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-xs font-bold">S</span>
            </div>
            <span className="font-heading text-lg font-bold tracking-tight">
              ScholarFlow
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/projects">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                我的项目
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                登录
              </Button>
            </Link>
            <Link href="/projects/new">
              <Button size="sm" className="bg-teal text-teal-foreground hover:bg-teal/90">
                开始使用
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 pt-14">
        <section className="relative overflow-hidden">
          {/* Subtle gradient wash */}
          <div className="absolute inset-0 bg-gradient-to-br from-teal/5 via-transparent to-primary/5 pointer-events-none" />
          <div className="max-w-6xl mx-auto px-6 pt-24 pb-20 relative">
            <div className="max-w-2xl animate-fade-up">
              <p className="text-sm font-medium text-teal tracking-wide uppercase mb-4">
                AI-Powered Research Platform
              </p>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.15] tracking-tight">
                让管理学研究
                <br />
                <span className="bg-gradient-to-r from-teal to-primary bg-clip-text text-transparent animate-shimmer">
                  更高效、更深入
                </span>
              </h1>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-xl">
                从文献检索到理论整合，ScholarFlow 用 AI 双引擎赋能科研全流程。支持 Gemini、ChatGPT、DeepSeek、Claude 四大模型自由切换。
              </p>
              <div className="mt-10 flex items-center gap-4">
                <Link href="/projects/new">
                  <Button size="lg" className="bg-teal text-teal-foreground hover:bg-teal/90 h-12 px-8 text-base">
                    创建研究项目
                  </Button>
                </Link>
                <Link href="/projects">
                  <Button variant="outline" size="lg" className="h-12 px-8 text-base">
                    浏览项目
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Features — editorial numbered list, not cards */}
        <section className="border-t border-border/50">
          <div className="max-w-6xl mx-auto px-6 py-20">
            <div className="stagger-children grid gap-0 divide-y divide-border/50">
              {features.map((f) => (
                <div
                  key={f.number}
                  className="animate-fade-up group grid grid-cols-[auto_1fr] gap-8 py-8 first:pt-0 last:pb-0"
                >
                  <span className="text-5xl font-heading font-bold text-border group-hover:text-teal/40 transition-colors duration-300">
                    {f.number}
                  </span>
                  <div className="pt-2">
                    <h3 className="text-xl font-semibold tracking-tight group-hover:text-teal transition-colors duration-300">
                      {f.title}
                    </h3>
                    <p className="mt-2 text-muted-foreground leading-relaxed max-w-lg">
                      {f.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Models strip */}
        <section className="bg-primary text-primary-foreground">
          <div className="max-w-6xl mx-auto px-6 py-12">
            <p className="text-sm uppercase tracking-wide text-primary-foreground/60 mb-6">
              四大模型，自由切换
            </p>
            <div className="grid sm:grid-cols-4 gap-6">
              {[
                { name: "Gemini 3.1 Pro", tag: "Google" },
                { name: "GPT-4o", tag: "OpenAI" },
                { name: "DeepSeek Reasoning", tag: "推理" },
                { name: "Claude Sonnet 4", tag: "Anthropic" },
              ].map((m) => (
                <div key={m.name} className="flex items-baseline gap-2">
                  <span className="text-lg font-medium">{m.name}</span>
                  <span className="text-xs text-primary-foreground/50">{m.tag}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-heading">ScholarFlow</span>
          <div className="flex items-center gap-4">
            <Link href="/help" className="hover:text-foreground transition-colors">
              网络兼容性说明
            </Link>
            <span>Powered by Claude AI & NotebookLM</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
