"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Filter,
  HelpCircle,
  X,
  Send,
  PenLine,
  Eye,
  Clock,
  CheckCircle2,
  ChevronLeft,
  MessageSquare,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TheoryTag {
  theory: string;
  relevance: string;
  explanation: string;
}

interface CaseStory {
  id: string;
  rawContent: string;
  anonymizedContent: string | null;
  academicSummary: string | null;
  obCategory: string | null;
  contextType: string | null;
  phenomena: string[];
  theoryTags: TheoryTag[] | string[];
  bookmarked?: boolean;
  viewCount: number;
  bookmarkCount: number;
  createdAt: string;
  status: string;
  userId?: string;
  followUpMessages?: Array<{ role: string; content: string }>;
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

// ─── Constants ──────────────────────────────────────────────────────────────

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

const categoryLabel = (val: string) =>
  CATEGORIES.find((c) => c.value === val)?.label ?? val;
const contextLabel = (val: string) =>
  CONTEXT_TYPES.find((c) => c.value === val)?.label ?? val;

// ─── Main Component ─────────────────────────────────────────────────────────

export default function CasesPage() {
  const { id: projectId } = useParams<{ id: string }>();

  // Case list state
  const [cases, setCases] = useState<CaseStory[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [contextType, setContextType] = useState("");

  // Selection & generation
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [researchTopic, setResearchTopic] = useState("");
  const [generating, setGenerating] = useState(false);
  const [ideas, setIdeas] = useState<GeneratedIdea[]>([]);

  // Detail panel
  const [activeCase, setActiveCase] = useState<CaseStory | null>(null);

  // Submit form
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitContent, setSubmitContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Processing indicator
  const [processingStoryId, setProcessingStoryId] = useState<string | null>(null);

  // Guide
  const [showGuide, setShowGuide] = useState(true);

  // Follow-up chat
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ─── Fetch cases ────────────────────────────────────────────────────────

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

  // ─── Selection & bookmark ───────────────────────────────────────────────

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

  // ─── Generate research questions ───────────────────────────────────────

  async function handleGenerate() {
    if (selected.size === 0 || !researchTopic.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/cases/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, storyIds: Array.from(selected), topic: researchTopic.trim() }),
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

  // ─── Submit story ─────────────────────────────────────────────────────

  // Poll a story until it reaches PUBLISHED, then refresh the list
  function pollUntilPublished(storyId: string) {
    setSubmitError("");
    setProcessingStoryId(storyId);
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/cases/my-stories`);
        if (!res.ok) return;
        const data = await res.json();
        const story = data.stories?.find((s: { id: string }) => s.id === storyId);
        if (!story) return;
        if (story.status === "PUBLISHED") {
          clearInterval(interval);
          setProcessingStoryId(null);
          fetchCases(1);
        } else if (story.status === "PENDING" || story.status === "PROCESSING") {
          // keep polling
        } else {
          // REJECTED or other
          clearInterval(interval);
          setProcessingStoryId(null);
          setSubmitError("故事处理失败，请重试");
        }
      } catch {
        // ignore network blips
      }
    }, 3000);
    // Stop polling after 2 minutes max
    setTimeout(() => {
      clearInterval(interval);
      setProcessingStoryId((prev) => {
        if (prev === storyId) {
          fetchCases(1); // try refresh anyway
          return null;
        }
        return prev;
      });
    }, 120000);
  }

  async function handleSubmit() {
    if (submitContent.trim().length < 5) {
      setSubmitError("请至少写5个字");
      return;
    }
    setSubmitError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/cases/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: submitContent }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || "提交失败");
        return;
      }
      setSubmitContent("");
      setShowSubmit(false);
      // Poll until the story is processed and published
      pollUntilPublished(data.id);
    } catch {
      setSubmitError("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Follow-up chat (for own stories) ─────────────────────────────────

  async function handleFollowUp() {
    if (!chatInput.trim() || !activeCase) return;
    setChatLoading(true);
    try {
      const res = await fetch(`/api/cases/${activeCase.id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput }),
      });
      const data = await res.json();
      if (activeCase) {
        setActiveCase({ ...activeCase, followUpMessages: data.messages });
      }
      setChatInput("");
    } finally {
      setChatLoading(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────

  // Right panel: detail view of selected case
  const renderDetailPanel = () => {
    if (!activeCase) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center py-20 text-muted-foreground">
          <Eye className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">选择左侧案例查看研究洞察</p>
        </div>
      );
    }

    const tags: TheoryTag[] = Array.isArray(activeCase.theoryTags)
      ? activeCase.theoryTags.map((t) =>
          typeof t === "string" ? { theory: t, relevance: "medium", explanation: "" } : t as TheoryTag,
        )
      : [];

    const phenomena: string[] = Array.isArray(activeCase.phenomena) ? activeCase.phenomena : [];

    return (
      <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-12rem)]">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setActiveCase(null)}
            className="lg:hidden flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="w-4 h-4" /> 返回列表
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleBookmark(activeCase.id)}
              className="text-muted-foreground hover:text-amber-500 transition-colors"
            >
              {activeCase.bookmarked ? (
                <BookmarkCheck className="h-4 w-4 text-amber-500" />
              ) : (
                <Bookmark className="h-4 w-4" />
              )}
            </button>
            <span className="text-xs text-muted-foreground">
              {activeCase.viewCount} 次浏览
            </span>
          </div>
        </div>

        {/* Status badge for processing stories */}
        {activeCase.status !== "PUBLISHED" && (
          <div className="flex items-center gap-2 text-sm">
            {activeCase.status === "PROCESSING" && (
              <span className="flex items-center gap-1 text-blue-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> AI 分析中...
              </span>
            )}
            {activeCase.status === "PENDING" && (
              <span className="flex items-center gap-1 text-amber-500">
                <Clock className="w-3.5 h-3.5" /> 等待处理
              </span>
            )}
          </div>
        )}

        {/* Raw content (anonymized or original) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">案例讲述</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {activeCase.anonymizedContent || activeCase.rawContent}
            </p>
          </CardContent>
        </Card>

        {/* Academic summary */}
        {activeCase.academicSummary && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">学术摘要</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">
                {activeCase.academicSummary}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Theory tags */}
        {tags.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Tag className="w-3.5 h-3.5" /> 理论标签
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {tags.map((tag, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full mt-0.5 shrink-0 ${
                      tag.relevance === "high"
                        ? "bg-teal/10 text-teal"
                        : tag.relevance === "medium"
                          ? "bg-amber-50 text-amber-600"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {tag.theory}
                  </span>
                  {tag.explanation && (
                    <span className="text-xs text-muted-foreground">
                      {tag.explanation}
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Key phenomena */}
        {phenomena.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {phenomena.map((p, i) => (
              <span
                key={i}
                className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600"
              >
                {p}
              </span>
            ))}
          </div>
        )}

        {/* Category & context */}
        <div className="flex gap-2 text-xs">
          {activeCase.obCategory && (
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {categoryLabel(activeCase.obCategory)}
            </span>
          )}
          {activeCase.contextType && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {contextLabel(activeCase.contextType)}
            </span>
          )}
        </div>

        {/* Follow-up conversation */}
        {activeCase.followUpMessages && activeCase.followUpMessages.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5" /> AI 对话补充
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {activeCase.followUpMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-xs p-2.5 rounded-lg ${
                      msg.role === "assistant"
                        ? "bg-secondary"
                        : "bg-teal/5 ml-6"
                    }`}
                  >
                    {msg.content}
                  </div>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleFollowUp();
                }}
                className="flex gap-2"
              >
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="回复 AI 的提问..."
                  disabled={chatLoading}
                  className="text-xs"
                />
                <Button
                  type="submit"
                  size="icon"
                  variant="outline"
                  disabled={chatLoading || !chatInput.trim()}
                  className="h-8 w-8 shrink-0"
                >
                  {chatLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">案例库</h1>
          <p className="text-sm text-muted-foreground mt-1">
            浏览和分享组织行为学案例，生成研究问题与假设
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setShowSubmit(!showSubmit)}
            className="bg-teal text-teal-foreground hover:bg-teal/90"
          >
            <PenLine className="w-3.5 h-3.5 mr-1" />
            分享故事
          </Button>
          {!showGuide && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setShowGuide(true)}
            >
              <HelpCircle className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Submit form */}
      {showSubmit && (
        <Card className="border-teal/30">
          <CardContent className="pt-5 space-y-3">
            <div className="rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground leading-relaxed">
              请像讲故事一样写下当时发生了什么、谁参与其中、谁影响了谁、大家可能为什么这样反应。AI
              会自动匿名化并识别其中的组织行为学现象和理论视角。
            </div>
            <Textarea
              placeholder="在这里描述你观察到的职场现象..."
              value={submitContent}
              onChange={(e) => setSubmitContent(e.target.value)}
              rows={6}
              className="resize-none text-sm"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {submitContent.length} 字
                {submitContent.length > 0 &&
                  submitContent.length < 50 &&
                  "（至少 5 字）"}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowSubmit(false);
                    setSubmitContent("");
                    setSubmitError("");
                  }}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={submitting || submitContent.trim().length < 5}
                  className="bg-teal text-teal-foreground hover:bg-teal/90"
                >
                  {submitting ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5 mr-1" />
                  )}
                  提交故事
                </Button>
              </div>
            </div>
            {submitError && (
              <p className="text-xs text-destructive">{submitError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Processing indicator */}
      {processingStoryId && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          <span className="text-sm text-blue-600">
            AI 正在处理你的故事，完成后将自动刷新列表（通常需要 10-30 秒）...
          </span>
        </div>
      )}

      {/* Collapsible guide */}
      {showGuide && (
        <Card className="border-teal/20 bg-teal/5">
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2.5 text-sm leading-relaxed">
                <p className="font-medium text-base">如何使用案例库</p>
                <ol className="list-decimal ml-5 space-y-1 text-muted-foreground text-xs">
                  <li>
                    <span className="text-foreground font-medium">分享故事</span>
                    &nbsp;— 点击右上角「分享故事」按钮，写下你观察到的职场现象。AI 会自动匿名化、提取学术摘要和理论标签。
                  </li>
                  <li>
                    <span className="text-foreground font-medium">浏览案例</span>
                    &nbsp;— 左侧列表展示所有公开案例，点击卡片查看右侧的完整研究洞察。
                  </li>
                  <li>
                    <span className="text-foreground font-medium">收藏案例</span>
                    &nbsp;— 点击书签图标收藏到当前项目。
                  </li>
                  <li>
                    <span className="text-foreground font-medium">生成研究问题</span>
                    &nbsp;— 勾选案例后点击「生成研究问题」，AI 结合知识图谱生成假设。
                  </li>
                  <li>
                    <span className="text-foreground font-medium">AI 对话补充</span>
                    &nbsp;— 在右侧洞察面板中可以与 AI 进行追问对话，补充更多细节。
                  </li>
                </ol>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="shrink-0 p-1 rounded hover:bg-teal/10 text-muted-foreground hover:text-foreground transition-colors"
                title="隐藏说明"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

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
          <SelectTrigger className="w-[140px]">
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
          <SelectTrigger className="w-[140px]">
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
        <div className="space-y-2 rounded-lg border border-teal-500/30 bg-teal-500/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium shrink-0">
              已选择 {selected.size} 个案例
            </span>
            <Input
              value={researchTopic}
              onChange={(e) => setResearchTopic(e.target.value)}
              placeholder="输入你的研究方向或话题，如：远程办公对团队信任的影响"
              className="flex-1 h-8 text-sm"
            />
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating || !researchTopic.trim()}
              className="bg-teal-600 hover:bg-teal-700 text-white shrink-0"
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
              className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              清空
            </button>
          </div>
          {!researchTopic.trim() && (
            <p className="text-xs text-muted-foreground">
              请先输入研究方向，AI 将结合所选案例和你的研究话题生成研究问题与假设
            </p>
          )}
        </div>
      )}

      {/* Two-panel layout */}
      <div className="flex gap-5 min-h-[60vh]">
        {/* Left: case list */}
        <div
          className={`space-y-3 overflow-y-auto max-h-[calc(100vh-16rem)] ${
            activeCase ? "hidden lg:block lg:w-[45%]" : "w-full"
          }`}
        >
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                加载案例中...
              </span>
            </div>
          ) : cases.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground text-sm">
              暂无案例数据，点击「分享故事」提交第一个案例
            </div>
          ) : (
            <>
              {cases.map((c) => {
                const isSelected = selected.has(c.id);
                const isActive = activeCase?.id === c.id;
                const summary =
                  c.academicSummary ||
                  (c.anonymizedContent
                    ? c.anonymizedContent.slice(0, 100) + "..."
                    : c.rawContent?.slice(0, 100) + "...");

                return (
                  <div
                    key={c.id}
                    onClick={() => setActiveCase(c)}
                    className={`group cursor-pointer rounded-lg border p-3.5 transition-colors ${
                      isActive
                        ? "border-teal/50 bg-teal/5"
                        : isSelected
                          ? "border-teal-500/30 bg-teal-500/5"
                          : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Checkbox */}
                      <div
                        role="checkbox"
                        aria-checked={isSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(c.id);
                        }}
                        className={`mt-0.5 h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? "border-teal-500 bg-teal-500 text-white"
                            : "border-muted-foreground/30 hover:border-teal-500/50"
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="h-2.5 w-2.5"
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
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-snug line-clamp-3">
                          {summary}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {c.obCategory && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                              <Tag className="h-2.5 w-2.5" />
                              {categoryLabel(c.obCategory)}
                            </span>
                          )}
                          {c.status === "PROCESSING" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 flex items-center gap-0.5">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              分析中
                            </span>
                          )}
                          {c.status === "PUBLISHED" && (
                            <CheckCircle2 className="h-3 w-3 text-teal" />
                          )}
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(c.createdAt).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                      </div>

                      {/* Bookmark */}
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleBookmark(c.id);
                        }}
                        className="shrink-0 text-muted-foreground hover:text-amber-500 transition-colors"
                      >
                        {c.bookmarked ? (
                          <BookmarkCheck className="h-3.5 w-3.5 text-amber-500" />
                        ) : (
                          <Bookmark className="h-3.5 w-3.5" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

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
                  <span className="text-xs text-muted-foreground">
                    {page} / {totalPages}
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
            </>
          )}
        </div>

        {/* Right: research insights detail */}
        {(activeCase || !loading) && (
          <div
            className={`${
              activeCase
                ? "w-full lg:w-[55%] lg:border-l lg:pl-5 border-border/50"
                : "hidden lg:block lg:w-[55%] lg:border-l lg:pl-5 border-border/50"
            }`}
          >
            {renderDetailPanel()}
          </div>
        )}
      </div>

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
