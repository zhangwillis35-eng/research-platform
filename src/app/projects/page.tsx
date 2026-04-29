"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface Project {
  id: string;
  name: string;
  domain?: string;
  description?: string;
  _count: { papers: number; ideas: number };
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects?userId=default-user")
      .then((r) => r.json())
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto flex h-14 items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-[10px] font-bold">S</span>
            </div>
            <span className="font-heading text-sm font-bold">
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
        <h1 className="font-heading text-2xl font-bold mb-8">
          我的研究项目
        </h1>

        {loading ? (
          <div className="text-sm text-muted-foreground">加载中...</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <div className="group border border-border/50 rounded-lg p-5 hover:border-teal/30 hover:shadow-sm transition-all duration-200 bg-card">
                  <div className="flex items-center justify-between mb-3">
                    {p.domain && (
                      <span className="text-xs text-teal font-medium bg-teal/10 px-2 py-0.5 rounded">
                        {p.domain}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {p._count.papers} 篇文献 · {p._count.ideas} 个想法
                    </span>
                  </div>
                  <h3 className="font-semibold text-base group-hover:text-teal transition-colors">
                    {p.name}
                  </h3>
                  {p.description && (
                    <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">
                      {p.description}
                    </p>
                  )}
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
        )}
      </main>
    </div>
  );
}
