"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";

interface Theory {
  id: string;
  name: string;
  nameEn: string;
  coreConstructs: string[];
  assumptions: string[];
  boundaries: string[];
  papers: number[];
}

interface Connection {
  from: string;
  to: string;
  sharedConstructs: string[];
  integrationPotential: string;
  strength: "strong" | "moderate" | "weak";
}

interface Framework {
  title: string;
  description: string;
  centralTheory: string;
  layers: { name: string; theories: string[]; role: string }[];
}

const strengthColors: Record<string, string> = {
  strong: "bg-green-100 text-green-700",
  moderate: "bg-amber-100 text-amber-700",
  weak: "bg-gray-100 text-gray-600",
};

export default function TheoriesIntegratePage() {
  const [topic, setTopic] = useState("");
  const [provider, setProvider] = useState<AIProvider>("gemini");
  const [loading, setLoading] = useState(false);
  const [theories, setTheories] = useState<Theory[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [framework, setFramework] = useState<Framework | null>(null);
  const [selectedTheory, setSelectedTheory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;

    setLoading(true);
    setError(null);
    setTheories([]);
    setConnections([]);
    setFramework(null);

    try {
      // Search papers first
      const searchRes = await fetch("/api/research/deep-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, provider }),
      });
      if (!searchRes.ok) throw new Error("文献检索失败");
      const { papers } = await searchRes.json();

      if (!papers.length) {
        setError("未找到文献");
        setLoading(false);
        return;
      }

      // Analyze theories
      const res = await fetch("/api/research/theories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ papers, topic, provider }),
      });
      if (!res.ok) throw new Error("理论分析失败");
      const data = await res.json();

      setTheories(data.theories ?? []);
      setConnections(data.connections ?? []);
      setFramework(data.framework ?? null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const selectedT = theories.find((t) => t.id === selectedTheory);
  const relatedConnections = selectedTheory
    ? connections.filter((c) => c.from === selectedTheory || c.to === selectedTheory)
    : connections;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-serif-sc)] text-2xl font-bold">
            理论整合引擎
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            识别理论框架 · 发现跨理论连接 · 生成整合框架
          </p>
        </div>
        <AIProviderSelect value={provider} onChange={setProvider} />
      </div>

      <form onSubmit={handleAnalyze} className="flex gap-3">
        <Input
          placeholder="输入研究主题，如：organizational ambidexterity innovation"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={loading}
          className="bg-teal text-teal-foreground hover:bg-teal/90"
        >
          {loading ? "分析中..." : "分析理论"}
        </Button>
      </form>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">{error}</div>
      )}

      {theories.length > 0 && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          {/* Main area */}
          <div className="space-y-6">
            {/* Integration framework */}
            {framework && (
              <Card className="border-teal/20 bg-teal/[0.02]">
                <CardHeader>
                  <CardTitle className="text-base font-[family-name:var(--font-serif-sc)]">
                    {framework.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{framework.description}</p>
                  {framework.layers.map((layer, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-teal font-bold text-sm shrink-0 w-6">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{layer.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{layer.role}</p>
                        <div className="flex gap-1 mt-1">
                          {layer.theories.map((tId) => {
                            const t = theories.find((th) => th.id === tId);
                            return t ? (
                              <Badge key={tId} variant="secondary" className="text-[10px]">
                                {t.name}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Connections */}
            <div>
              <h2 className="font-[family-name:var(--font-serif-sc)] text-lg font-semibold mb-3">
                跨理论连接
              </h2>
              <div className="space-y-3">
                {relatedConnections.map((c, i) => {
                  const fromT = theories.find((t) => t.id === c.from);
                  const toT = theories.find((t) => t.id === c.to);
                  return (
                    <div key={i} className="p-4 border border-border/50 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary" className="text-xs">{fromT?.name ?? c.from}</Badge>
                        <span className="text-muted-foreground">↔</span>
                        <Badge variant="secondary" className="text-xs">{toT?.name ?? c.to}</Badge>
                        <Badge className={`text-[10px] ml-auto ${strengthColors[c.strength]}`}>
                          {c.strength === "strong" ? "强连接" : c.strength === "moderate" ? "中等" : "弱连接"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{c.integrationPotential}</p>
                      {c.sharedConstructs.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          <span className="text-xs text-muted-foreground">共享构念：</span>
                          {c.sharedConstructs.map((sc) => (
                            <Badge key={sc} variant="outline" className="text-[10px]">{sc}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Theory sidebar */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium">识别的理论（{theories.length}）</h2>
            {theories.map((t) => (
              <Card
                key={t.id}
                className={`cursor-pointer transition-all ${
                  selectedTheory === t.id ? "border-teal/30 shadow-sm" : "hover:border-border"
                }`}
                onClick={() => setSelectedTheory(selectedTheory === t.id ? null : t.id)}
              >
                <CardContent className="p-4 space-y-2">
                  <div>
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.nameEn}</p>
                  </div>
                  {selectedTheory === t.id && (
                    <>
                      <Separator />
                      <div className="space-y-2 text-xs">
                        <div>
                          <p className="font-medium mb-1">核心构念</p>
                          <div className="flex flex-wrap gap-1">
                            {t.coreConstructs.map((c) => (
                              <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                            ))}
                          </div>
                        </div>
                        {t.assumptions.length > 0 && (
                          <div>
                            <p className="font-medium mb-1">关键假设</p>
                            {t.assumptions.map((a, i) => (
                              <p key={i} className="text-muted-foreground">• {a}</p>
                            ))}
                          </div>
                        )}
                        {t.boundaries.length > 0 && (
                          <div>
                            <p className="font-medium mb-1">边界条件</p>
                            {t.boundaries.map((b, i) => (
                              <p key={i} className="text-muted-foreground">• {b}</p>
                            ))}
                          </div>
                        )}
                        <p className="text-muted-foreground">引用文献: {t.papers.length} 篇</p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && theories.length === 0 && !error && (
        <Card className="min-h-[300px] flex items-center justify-center">
          <CardContent className="text-center text-muted-foreground">
            <div className="text-4xl mb-4">🔬</div>
            <p className="font-medium">输入研究主题，AI 分析理论框架</p>
            <p className="text-sm mt-2 max-w-md mx-auto">
              自动识别各文献的理论基础、核心构念和边界条件，发现跨理论连接点，生成整合框架
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
