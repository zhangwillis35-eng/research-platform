"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain, description }),
      });
      if (!res.ok) throw new Error("创建失败");
      const { project } = await res.json();
      router.push(`/projects/${project.id}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto flex h-14 items-center px-6">
          <Link href="/projects" className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-[10px] font-bold">S</span>
            </div>
            <span className="font-heading text-sm font-bold">
              ScholarFlow
            </span>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">
              创建研究项目
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">项目名称</label>
                <Input
                  placeholder="如：数字化转型与组织韧性"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">研究领域</label>
                <Input
                  placeholder="如：战略管理、组织行为学"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">项目描述</label>
                <Textarea
                  placeholder="简要描述你的研究目标..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={creating}
                  className="bg-teal text-teal-foreground hover:bg-teal/90"
                >
                  {creating ? "创建中..." : "创建项目"}
                </Button>
                <Link href="/projects">
                  <Button variant="outline">取消</Button>
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
