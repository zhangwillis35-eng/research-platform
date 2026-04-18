import Link from "next/link";

const navItems = [
  { label: "概览", href: "", icon: "◐" },
  { label: "文献库", href: "/papers", icon: "▤" },
  { label: "文献检索", href: "/papers/search", icon: "◎" },
  { label: "文献综述", href: "/review/generate", icon: "¶" },
  { label: "知识图谱", href: "/graph", icon: "◈" },
  { label: "研究想法", href: "/ideas/generate", icon: "✦" },
  { label: "理论整合", href: "/theories/integrate", icon: "⬡" },
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
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border/50 bg-sidebar">
        <div className="sticky top-0 flex flex-col h-screen">
          <div className="p-4 border-b border-border/50">
            <Link href="/projects" className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
                <span className="text-primary-foreground text-[10px] font-bold">S</span>
              </div>
              <span className="font-[family-name:var(--font-serif-sc)] text-sm font-bold">
                ScholarFlow
              </span>
            </Link>
          </div>

          <nav className="flex-1 p-3 space-y-0.5">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={`/projects/${id}${item.href}`}
                className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors duration-150"
              >
                <span className="text-xs opacity-50 w-4 text-center">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="p-4 border-t border-border/50">
            <Link
              href="/projects"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← 返回项目列表
            </Link>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
