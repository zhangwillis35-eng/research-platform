"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";

const navItems = [
  { label: "项目概览", href: "", icon: "◐" },
  { label: "① 文献检索", href: "/papers/search", icon: "◎" },
  { label: "② 文献库", href: "/papers", icon: "▤" },
  { label: "③ AI 研究助手", href: "/notebooklm", icon: "💬" },
  { label: "④ 文献综述", href: "/review/generate", icon: "¶" },
  { label: "⑤ 知识图谱", href: "/graph", icon: "◈" },
  { label: "⑥ 研究想法", href: "/ideas/generate", icon: "✦" },
  { label: "⑦ 理论整合", href: "/theories/integrate", icon: "⬡" },
  { label: "⑧ 概念模型", href: "/model", icon: "◇" },
  { label: "⑨ Proposal", href: "/proposal", icon: "📝" },
  { label: "⑩ 参考文献", href: "/references", icon: "☰" },
  { label: "设置", href: "/settings", icon: "⚙" },
];

export function CollapsibleSidebar({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "me" }),
    })
      .then((r) => r.json())
      .then((d) => setUserName(d.user?.name || d.user?.phone || null))
      .catch(() => {});
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  async function handleLogout() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80">
      <div className="flex items-center h-12 px-4 gap-4">
        {/* Logo */}
        <Link href="/projects" className="flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
            <span className="text-primary-foreground text-[10px] font-bold">S</span>
          </div>
          <span className="font-heading text-sm font-bold">
            ScholarFlow
          </span>
        </Link>

        {/* Divider */}
        <div className="w-px h-5 bg-border/50 shrink-0" />

        {/* Nav items */}
        <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1">
          {navItems.map((item) => {
            const fullHref = `/projects/${projectId}${item.href}`;
            const isActive = item.href === ""
              ? pathname === fullHref
              : pathname.startsWith(fullHref);

            return (
              <Link
                key={item.label}
                href={fullHref}
                className={`flex items-center gap-1.5 rounded-md text-xs whitespace-nowrap px-2.5 py-1.5 transition-colors duration-150 ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                }`}
              >
                <span className="text-[10px] opacity-60">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Back link */}
        <Link
          href="/projects"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          ← 项目列表
        </Link>

        {/* Divider */}
        <div className="w-px h-5 bg-border/50 shrink-0" />

        {/* User menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary">
              {userName ? userName[0].toUpperCase() : "?"}
            </span>
            <span className="max-w-[80px] truncate hidden sm:inline">
              {userName || "..."}
            </span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-popover border border-border rounded-md shadow-md py-1 z-50">
              <button
                onClick={handleLogout}
                className="w-full text-left px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
