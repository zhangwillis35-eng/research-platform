import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// TODO: fetch from database once Prisma is connected
const mockProjects = [
  {
    id: "demo-1",
    name: "AI Washing 与利益相关者关注",
    domain: "公司治理",
    description: "研究企业AI洗绿行为对利益相关者关注度的影响",
    paperCount: 0,
    updatedAt: "2026-04-18",
  },
];

export default function ProjectsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-6">
          <Link href="/" className="text-xl font-bold tracking-tight">
            ScholarFlow
          </Link>
          <Link href="/projects/new">
            <Button size="sm">+ 新建项目</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        <h1 className="text-2xl font-bold mb-6">我的研究项目</h1>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mockProjects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="h-full transition-colors hover:border-foreground/20 cursor-pointer">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {p.domain}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.paperCount} 篇文献
                    </span>
                  </div>
                  <CardTitle className="text-lg mt-2">{p.name}</CardTitle>
                  <CardDescription>{p.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}

          <Link href="/projects/new">
            <Card className="h-full border-dashed flex items-center justify-center min-h-[160px] transition-colors hover:border-foreground/20 cursor-pointer">
              <div className="text-center text-muted-foreground">
                <span className="text-3xl block mb-2">+</span>
                <span className="text-sm">创建新项目</span>
              </div>
            </Card>
          </Link>
        </div>
      </main>
    </div>
  );
}
