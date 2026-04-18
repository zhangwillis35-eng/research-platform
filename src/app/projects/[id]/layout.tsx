import Link from "next/link";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "概览", href: "" },
  { label: "文献库", href: "/papers" },
  { label: "文献检索", href: "/papers/search" },
  { label: "文献综述", href: "/review/generate" },
  { label: "知识图谱", href: "/graph" },
  { label: "研究想法", href: "/ideas/generate" },
  { label: "理论整合", href: "/theories/integrate" },
];

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link href="/projects" className="text-xl font-bold tracking-tight">
              ScholarFlow
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-sm">项目</span>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={`/projects/${id}${item.href}`}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none border-b-2 border-transparent hover:border-foreground/20 text-muted-foreground hover:text-foreground"
                >
                  {item.label}
                </Button>
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
        {children}
      </main>
    </div>
  );
}
