"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";

// ─── Types ─────────────────────────────────────

interface Paper {
  id?: string;
  title: string;
  authors?: { name: string }[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  papers?: Paper[]; // papers referenced in this message
  type?: "text" | "papers" | "questions";
}

// Preset question templates
const PRESET_QUESTIONS = [
  {
    label: "文献综述分析",
    icon: "¶",
    questions: [
      "这些文献的主要研究发现是什么？按主题分类归纳。",
      "这些文献在研究方法和数据来源上有哪些共同点和差异？",
      "是否存在相互矛盾的结论？矛盾的原因可能是什么？",
      "目前最大的研究空白（research gap）是什么？",
    ],
  },
  {
    label: "变量提取",
    icon: "◈",
    questions: [
      "所有被研究的自变量（IV）有哪些？逐一列出。",
      "因变量（DV）分别是什么？如何测量的？",
      "涉及了哪些中介变量和调节变量？效应量多大？",
      "使用了哪些控制变量？有哪些遗漏变量？",
    ],
  },
  {
    label: "理论框架",
    icon: "⬡",
    questions: [
      "分别使用了哪些理论框架？每个理论的核心假设是什么？",
      "不同理论框架之间有什么联系或冲突？可否整合？",
      "理论在什么边界条件下成立？",
    ],
  },
  {
    label: "研究想法",
    icon: "✦",
    questions: [
      "哪些理论视角尚未被应用？哪些跨学科理论可能带来新洞见？",
      "哪些新兴情境还未被充分研究？",
      "研究方法上有什么局限？哪些新方法可能产生新发现？",
    ],
  },
];

export default function NotebookLMPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content:
        "欢迎使用 NotebookLM 智能分析。你可以：\n\n1. 从文献库加载论文作为分析上下文\n2. 使用预设问题模板快速提问\n3. 自由提问，AI 会基于已加载的文献进行深度分析\n\n请先加载文献，或直接开始提问。",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiProvider, setAiProvider] = useState<AIProvider>("gemini-pro");
  const [loadedPapers, setLoadedPapers] = useState<Paper[]>([]);
  const [showPaperPanel, setShowPaperPanel] = useState(true);
  const [loadingPapers, setLoadingPapers] = useState(false);
  const xAbort = useAbort();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load papers from project library
  async function loadProjectPapers() {
    setLoadingPapers(true);
    try {
      const res = await fetch(`/api/papers?projectId=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        const papers = data.papers ?? [];
        setLoadedPapers(papers);
        if (papers.length > 0) {
          addMessage("system", `已加载 ${papers.length} 篇文献作为分析上下文。你现在可以提问了。`);
        } else {
          addMessage("system", "文献库为空。请先在「文献检索」页面搜索并添加文献到文献库。");
        }
      }
    } catch {
      addMessage("system", "加载文献失败，请检查网络连接。");
    } finally {
      setLoadingPapers(false);
    }
  }

  function addMessage(role: ChatMessage["role"], content: string, papers?: Paper[]) {
    const msg: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      role,
      content,
      timestamp: new Date(),
      papers,
    };
    setMessages((prev) => [...prev, msg]);
    return msg;
  }

  // Build context from loaded papers
  function buildPaperContext(): string {
    if (loadedPapers.length === 0) return "";
    return loadedPapers
      .map(
        (p, i) =>
          `[${i + 1}] ${p.title}\n${p.authors?.map((a) => a.name).join(", ") ?? ""} (${p.year ?? "N/A"})${p.venue ? ` — ${p.venue}` : ""}\n${p.abstract ?? "(无摘要)"}`
      )
      .join("\n\n---\n\n");
  }

  async function handleSend(questionOverride?: string) {
    const text = questionOverride ?? input.trim();
    if (!text || loading) return;

    const signal = xAbort.reset();
    addMessage("user", text);
    if (!questionOverride) setInput("");
    setLoading(true);

    try {
      const paperContext = buildPaperContext();
      const systemPrompt = paperContext
        ? `你是一位管理学文献分析专家。以下是用户的研究文献库（共 ${loadedPapers.length} 篇）：\n\n${paperContext}\n\n请基于这些文献回答用户的问题。引用具体文献时请标注编号如 [1]、[2]。用中文回答，学术写作风格。`
        : "你是一位管理学研究助手。用户还没有加载文献，请提醒他先加载文献库，或直接回答学术问题。用中文回答。";

      // Get conversation history (last 10 messages)
      const history = messages
        .filter((m) => m.role !== "system")
        .slice(-10)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: aiProvider,
          system: systemPrompt,
          messages: [...history, { role: "user", content: text }],
        }),
        signal,
      });

      if (!res.ok) throw new Error("AI 调用失败");

      // Stream response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let fullText = "";
      const assistantMsgId = Date.now().toString() + "ai";
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
        },
      ]);

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              fullText += data.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: fullText } : m
                )
              );
            }
          } catch {
            /* skip */
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") { setLoading(false); return; }
      addMessage("system", `错误: ${String(err)}`);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border/50">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            NotebookLM 智能分析
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            基于文献库的多轮对话 · 深度分析 · 上下文记忆
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant="secondary"
            className="text-xs cursor-pointer"
            onClick={() => setShowPaperPanel(!showPaperPanel)}
          >
            {loadedPapers.length} 篇文献已加载
          </Badge>
          <AIProviderSelect value={aiProvider} onChange={setAiProvider} />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 mt-4 gap-4">
        {/* Left: Paper context panel */}
        {showPaperPanel && (
          <div className="w-64 shrink-0 flex flex-col border border-border/50 rounded-lg bg-card overflow-hidden">
            <div className="p-3 border-b border-border/50 flex items-center justify-between">
              <span className="text-sm font-medium">文献上下文</span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2"
                onClick={loadProjectPapers}
                disabled={loadingPapers}
              >
                {loadingPapers ? "加载中..." : "从文献库加载"}
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {loadedPapers.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2 text-center">
                  点击上方「从文献库加载」<br />或在文献检索中添加文献
                </p>
              ) : (
                loadedPapers.map((p, i) => (
                  <div
                    key={p.id || i}
                    className="p-2 rounded-md border border-border/30 hover:border-teal/30 transition-colors"
                  >
                    <p className="text-[11px] font-medium leading-snug line-clamp-2">
                      [{i + 1}] {p.title}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {p.year ?? "?"} · {p.venue?.slice(0, 25) ?? ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Right: Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-teal text-teal-foreground"
                      : msg.role === "system"
                        ? "bg-muted/50 text-muted-foreground border border-border/50"
                        : "bg-card border border-border/50"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex items-center gap-1.5 mb-1.5 text-[10px] text-muted-foreground">
                      <span>AI</span>
                      {loading && msg === messages[messages.length - 1] && (
                        <span className="animate-pulse">思考中...</span>
                      )}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  <div className="text-[9px] mt-2 opacity-50">
                    {msg.timestamp.toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Preset questions */}
          {messages.length <= 2 && (
            <div className="py-3 border-t border-border/30">
              <p className="text-[11px] text-muted-foreground mb-2">快速提问模板：</p>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_QUESTIONS.map((group) => (
                  <Card
                    key={group.label}
                    className="cursor-pointer hover:border-teal/30 transition-colors"
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-xs">{group.icon}</span>
                        <span className="text-xs font-medium">{group.label}</span>
                      </div>
                      <div className="space-y-1">
                        {group.questions.slice(0, 2).map((q) => (
                          <button
                            key={q}
                            className="text-[11px] text-muted-foreground hover:text-teal text-left block w-full truncate transition-colors"
                            onClick={() => handleSend(q)}
                          >
                            → {q}
                          </button>
                        ))}
                        {group.questions.length > 2 && (
                          <span className="text-[10px] text-muted-foreground/50">
                            +{group.questions.length - 2} 更多
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <Separator className="my-2" />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex gap-2 pb-2"
          >
            <Input
              ref={inputRef}
              placeholder={
                loadedPapers.length > 0
                  ? `基于 ${loadedPapers.length} 篇文献提问...`
                  : "请先加载文献，或直接提问..."
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-teal text-teal-foreground hover:bg-teal/90"
            >
              {loading ? "分析中..." : "发送"}
            </Button>
            <StopButton show={loading} onClick={xAbort.abort} />
          </form>
        </div>
      </div>
    </div>
  );
}
