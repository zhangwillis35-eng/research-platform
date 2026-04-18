import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const features = [
  {
    title: "智能文献检索",
    description:
      "多源聚合检索 Semantic Scholar、OpenAlex、Google Scholar，一键去重整合",
    icon: "🔍",
  },
  {
    title: "AI 文献综述",
    description:
      "基于 NotebookLM 全文分析 + Claude 结构化输出，生成有引用的文献综述",
    icon: "📝",
  },
  {
    title: "变量关系图谱",
    description:
      "自动提取自变量、因变量、中介/调节变量，构建可交互知识图谱",
    icon: "🕸️",
  },
  {
    title: "研究想法生成",
    description:
      "理论 × 情境 × 方法 组合矩阵，AI 评估新颖性与可行性",
    icon: "💡",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight">
              ScholarFlow
            </span>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              Beta
            </span>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/projects">
              <Button variant="ghost" size="sm">
                我的项目
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              AI 赋能管理学
              <br />
              <span className="text-muted-foreground">科研全流程</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              从文献检索、综述生成、变量关系图谱构建，到研究想法生成与理论整合。
              <br />
              结合 Claude AI 与 NotebookLM 双引擎，让科研更高效。
            </p>
            <div className="mt-8 flex gap-4">
              <Link href="/projects/new">
                <Button size="lg">创建研究项目</Button>
              </Link>
              <Link href="/projects">
                <Button variant="outline" size="lg">
                  浏览项目
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 pb-20">
          <div className="grid gap-6 sm:grid-cols-2">
            {features.map((f) => (
              <Card
                key={f.title}
                className="h-full transition-colors hover:border-foreground/20"
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span className="text-2xl">{f.icon}</span>
                    {f.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">
                    {f.description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t py-6">
        <div className="max-w-7xl mx-auto px-6 text-center text-sm text-muted-foreground">
          ScholarFlow — Powered by Claude AI & NotebookLM
        </div>
      </footer>
    </div>
  );
}
