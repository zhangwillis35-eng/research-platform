import Link from "next/link";
import { Button } from "@/components/ui/button";

const mockProjects = [
  {
    id: "demo-1",
    name: "AI Washing 与利益相关者关注",
    domain: "公司治理",
    description: "研究企业AI洗绿行为对利益相关者关注度的影响",
    paperCount: 0,
  },
];

export default function ProjectsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto flex h-14 items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-[10px] font-bold">S</span>
            </div>
            <span className="font-[family-name:var(--font-serif-sc)] text-sm font-bold">
              ScholarFlow
            </span>
          </Link>
          <Link href="/projects/new">
            <Button size="sm" className="bg-teal text-teal-foreground hover:bg-teal/90">
              + 新建项目
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        <h1 className="font-[family-name:var(--font-serif-sc)] text-2xl font-bold mb-8">
          我的研究项目
        </h1>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mockProjects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <div className="group border border-border/50 rounded-lg p-5 hover:border-teal/30 hover:shadow-sm transition-all duration-200 bg-card">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-teal font-medium bg-teal/10 px-2 py-0.5 rounded">
                    {p.domain}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.paperCount} 篇
                  </span>
                </div>
                <h3 className="font-semibold text-base group-hover:text-teal transition-colors">
                  {p.name}
                </h3>
                <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">
                  {p.description}
                </p>
              </div>
            </Link>
          ))}

          <Link href="/projects/new">
            <div className="border border-dashed border-border/50 rounded-lg flex items-center justify-center min-h-[140px] hover:border-teal/40 transition-colors cursor-pointer group">
              <div className="text-center text-muted-foreground group-hover:text-teal transition-colors">
                <span className="text-2xl block mb-1">+</span>
                <span className="text-sm">创建新项目</span>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
