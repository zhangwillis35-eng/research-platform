"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Clock,
  RefreshCw,
  Send,
  Trash2,
  Tag,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";

interface Story {
  id: string;
  rawContent: string;
  status: string;
  anonymizedContent: string | null;
  academicSummary: string | null;
  keyPhenomena: string[] | null;
  theoryTags: Array<{
    theory: string;
    relevance: string;
    explanation: string;
  }> | null;
  obCategory: string | null;
  contextType: string | null;
  followUpMessages: Array<{ role: string; content: string }> | null;
  viewCount: number;
  bookmarkCount: number;
  createdAt: string;
}

export default function StoryDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatInput, setChatInput] = usePersistedState(`contribute-story-${id}`, "chatInput", "");
  const [chatLoading, setChatLoading] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  function fetchStory() {
    fetch(`/api/stories/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setStory(data.story);
        setLoading(false);
      })
      .catch(() => {
        toast.error("加载故事失败，请刷新重试");
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchStory();
    // Poll while processing
    const interval = setInterval(() => {
      fetch(`/api/stories/${id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.story) setStory(data.story);
          if (data.story?.status !== "PROCESSING") clearInterval(interval);
        });
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleFollowUp() {
    if (!chatInput.trim()) return;
    setChatLoading(true);
    try {
      const res = await fetch(`/api/stories/${id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (story) {
        setStory({ ...story, followUpMessages: data.messages });
      }
      setChatInput("");
    } catch {
      toast.error("发送消息失败，请重试");
    } finally {
      setChatLoading(false);
    }
  }

  async function handleStartChat() {
    setChatLoading(true);
    try {
      const res = await fetch(`/api/stories/${id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (story) {
        setStory({ ...story, followUpMessages: data.messages });
      }
    } catch {
      toast.error("开始对话失败，请稍后重试");
    } finally {
      setChatLoading(false);
    }
  }

  async function handleReprocess() {
    setReprocessing(true);
    try {
      await fetch(`/api/stories/${id}/process`, { method: "POST" });
      // Poll for completion
      setTimeout(fetchStory, 2000);
    } catch {
      toast.error("重新分析请求失败，请重试");
    }
    setReprocessing(false);
  }

  async function handleDelete() {
    if (!confirm("确定删除这个故事？此操作不可撤销。")) return;
    try {
      await fetch(`/api/stories/${id}`, { method: "DELETE" });
      router.push("/contribute/dashboard");
    } catch {
      toast.error("删除故事失败，请重试");
    }
  }

  if (loading || !story) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isProcessing = story.status === "PROCESSING";
  const isPublished = story.status === "PUBLISHED";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/contribute/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> 返回
        </Link>
        <div className="flex gap-2">
          {!isProcessing && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReprocess}
              disabled={reprocessing}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 mr-1 ${reprocessing ? "animate-spin" : ""}`}
              />
              重新分析
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> 删除
          </Button>
        </div>
      </div>

      {/* Original story */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            你的故事
            {isProcessing && (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            )}
            {isPublished && <CheckCircle2 className="w-4 h-4 text-teal" />}
            {story.status === "PENDING" && (
              <Clock className="w-4 h-4 text-amber-500" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {story.rawContent}
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            提交于 {new Date(story.createdAt).toLocaleString("zh-CN")}
          </p>
        </CardContent>
      </Card>

      {/* AI Analysis Results */}
      {isPublished && (
        <>
          {story.academicSummary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">学术摘要</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">
                  {story.academicSummary}
                </p>
              </CardContent>
            </Card>
          )}

          {story.theoryTags && story.theoryTags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Tag className="w-4 h-4" /> 理论标签
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {story.theoryTags.map((tag, i) => (
                  <div key={i} className="flex items-start gap-3">
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
                    <span className="text-sm text-muted-foreground">
                      {tag.explanation}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {story.keyPhenomena && story.keyPhenomena.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {story.keyPhenomena.map((p, i) => (
                <span
                  key={i}
                  className="text-xs bg-secondary px-2.5 py-1 rounded-full"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {isProcessing && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
            <p>AI 正在分析你的故事，通常需要 10-30 秒...</p>
          </CardContent>
        </Card>
      )}

      {/* Follow-up conversation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 对话补充</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!story.followUpMessages ||
          story.followUpMessages.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">
                AI 可以向你提问，帮助补充更多细节，让故事对研究者更有价值。
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartChat}
                disabled={chatLoading}
              >
                {chatLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : null}
                开始对话
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {story.followUpMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-sm p-3 rounded-lg ${
                      msg.role === "assistant" ? "bg-secondary" : "bg-teal/5 ml-8"
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
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={chatLoading || !chatInput.trim()}
                >
                  {chatLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
