"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bookmark,
  BookmarkCheck,
  Search,
  Loader2,
  Lightbulb,
  Tag,
  ChevronDown,
  ChevronUp,
  Filter,
} from "lucide-react";

interface CaseStory {
  id: string;
  anonymizedContent: string;
  academicSummary?: string;
  category: string;
  contextType: string;
  phenomena: string[];
  theoryTags: string[];
  bookmarked?: boolean;
}

interface GeneratedIdea {
  title: string;
  researchQuestion: string;
  hypotheses: string[];
  theoreticalBasis: string;
  methodology: string;
  caseLink: string;
  novelty: string;
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "全部分类" },
  { value: "leadership", label: "领导力" },
  { value: "motivation", label: "动机" },
  { value: "team_dynamics", label: "团队动力" },
  { value: "organizational_justice", label: "组织公正" },
  { value: "conflict", label: "冲突" },
  { value: "communication", label: "沟通" },
  { value: "power_politics", label: "权力与政治" },
  { value: "organizational_culture", label: "组织文化" },
  { value: "change_management", label: "变革管理" },
  { value: "decision_making", label: "决策" },
  { value: "emotions_stress", label: "情绪与压力" },
  { value: "diversity_inclusion", label: "多样性与包容" },
];

const CONTEXT_TYPES: { value: string; label: string }[] = [
  { value: "", label: "全部场景" },
  { value: "corporate", label: "企业" },
  { value: "startup", label: "创业公司" },
  { value: "government", label: "政府机关" },
  { value: "education", label: "教育" },
  { value: "healthcare", label: "医疗" },
  { value: "nonprofit", label: "非营利" },
  { value: "remote_work", label: "远程办公" },
  { value: "cross_cultural", label: "跨文化" },
];

const PAGE_SIZE = 12;

export default function CasesPage() {
  const { id: projectId } = useParams<{ id: string }>();

  const [cases, setCases] = useState<CaseStory[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [contextType, setContextType] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [ideas, setIdeas] = useState<GeneratedIdea[]>([]);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchCases = useCallback(
    async (p = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("projectId", projectId);
        params.set("page", String(p));
        if (category) params.set("category", category);
        if (contextType) params.set("contextType", contextType);
        if (search.trim()) params.set("q", search.trim());

        const res = await fetch(`/api/cases?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch cases");
        const data = await res.json();
        setCases(data.cases ?? []);
        setTotal(data.total ?? 0);
        setPage(p);
      } catch (err) {
        console.error("Failed to fetch cases:", err);
      } finally {
        setLoading(false);
      }
    },
    [projectId, category, contextType, search],
  );

  useEffect(() => {
    fetchCases(1);
  }, [category, contextType]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    fetchCases(1);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleBookmark(storyId: string) {
    try {
      const res = await fetch("/api/cases/bookmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, projectId }),
      });
      if (!res.ok) throw new Error("Failed to toggle bookmark");
      setCases((prev) =>
        prev.map((c) =>
          c.id === storyId ? { ...c, bookmarked: !c.bookmarked } : c,
        ),
      );
    } catch (err) {
      console.error("Failed to toggle bookmark:", err);
    }
  }

  async function handleGenerate() {
    if (selected.size === 0) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/cases/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          storyIds: Array.from(selected),
        }),
      });
      if (!res.ok) throw new Error("Failed to generate ideas");
      const data = await res.json();
      setIdeas(data.ideas ?? []);
    } catch (err) {
      console.error("Failed to generate ideas:", err);
    } finally {
      setGenerating(false);
    }
  }

  const categoryLabel = (val: string) =>
    CATEGORIES.find((c) => c.value === val)?.label ?? val;
  const contextLabel = (val: string) =>
    CONTEXT_TYPES.find((c) => c.value === val)?.label ?? val;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">案例库</h1>
        <p className="text-sm text-muted-foreground mt-1">
          浏览组织行为学案例，选择感兴趣的案例生成研究问题与假设
        </p>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={handleSearchSubmit}
          className="flex items-center gap-2 flex-1 min-w-[200px]"
        >
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索案例关键词..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-1" />
            搜索
          </Button>
        </form>

        <Select
          value={category || "__all__"}
          onValueChange={(v) => setCategory(v === "__all__" ? "" : (v ?? ""))}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="全部分类" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value || "__all__"} value={c.value || "__all__"}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={contextType || "__all__"}
          onValueChange={(v) => setContextType(v === "__all__" ? "" : (v ?? ""))}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="全部场景" />
          </SelectTrigger>
          <SelectContent>
            {CONTEXT_TYPES.map((c) => (
              <SelectItem key={c.value || "__all__"} value={c.value || "__all__"}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-teal-500/30 bg-teal-500/5 px-4 py-2">
          <span className="text-sm font-medium">
            已选择 {selected.size} 个案例
          </span>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Lightbulb className="h-4 w-4 mr-1" />
            )}
            生成研究问题
          </Button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors ml-auto"
          >
            清空选择
          </button>
        </div>
      )}

      {/* Cases grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            加载案例中...
          </span>
        </div>
      ) : cases.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          暂无案例数据
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cases.map((c) => {
            const isSelected = selected.has(c.id);
            const isExpanded = expandedId === c.id;

            return (
              <Card
                key={c.id}
                className={`transition-colors ${
                  isSelected
                    ? "border-teal-500/40 bg-teal-500/5"
                    : "hover:border-border"
                }`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    {/* Selection checkbox */}
                    <button
                      onClick={() => toggleSelect(c.id)}
                      className={`mt-0.5 h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? "border-teal-500 bg-teal-500 text-white"
                          : "border-muted-foreground/30 hover:border-teal-500/50"
                      }`}
                    >
                      {isSelected && (
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm font-medium leading-snug">
                        {c.academicSummary ||
                          c.anonymizedContent?.slice(0, 120) + "..."}
                      </CardTitle>
                    </div>

                    {/* Bookmark */}
                    <button
                      onClick={() => toggleBookmark(c.id)}
                      className="shrink-0 text-muted-foreground hover:text-amber-500 transition-colors"
                    >
                      {c.bookmarked ? (
                        <BookmarkCheck className="h-4 w-4 text-amber-500" />
                      ) : (
                        <Bookmark className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </CardHeader>

                <CardContent className="pt-0 space-y-2">
                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      <Tag className="h-3 w-3" />
                      {categoryLabel(c.category)}
                    </span>
                    {c.phenomena?.slice(0, 3).map((p) => (
                      <span
                        key={p}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                      >
                        {p}
                      </span>
                    ))}
                  </div>

                  {/* Expand / Collapse */}
                  {isExpanded && (
                    <div className="space-y-2 pt-2 border-t border-border/50">
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                        {c.anonymizedContent}
                      </p>
                      {c.theoryTags?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {c.theoryTags.map((t) => (
                            <span
                              key={t}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() =>
                      setExpandedId(isExpanded ? null : c.id)
                    }
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3" /> 收起
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" /> 展开详情
                      </>
                    )}
                  </button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => fetchCases(page - 1)}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            第 {page} / {totalPages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => fetchCases(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      {/* Generated ideas */}
      {ideas.length > 0 && (
        <div className="space-y-4 pt-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            生成的研究问题
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {ideas.map((idea, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    {idea.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-muted-foreground">
                      研究问题：
                    </span>
                    <span>{idea.researchQuestion}</span>
                  </div>
                  {idea.hypotheses?.length > 0 && (
                    <div>
                      <span className="font-medium text-muted-foreground">
                        假设：
                      </span>
                      <ul className="list-disc list-inside mt-1 space-y-0.5">
                        {idea.hypotheses.map((h, j) => (
                          <li key={j}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <span className="font-medium text-muted-foreground">
                      理论基础：
                    </span>
                    <span>{idea.theoreticalBasis}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">
                      方法建议：
                    </span>
                    <span>{idea.methodology}</span>
                  </div>
                  {idea.caseLink && (
                    <div>
                      <span className="font-medium text-muted-foreground">
                        案例关联：
                      </span>
                      <span>{idea.caseLink}</span>
                    </div>
                  )}
                  {idea.novelty && (
                    <div>
                      <span className="font-medium text-muted-foreground">
                        新颖性：
                      </span>
                      <span>{idea.novelty}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
