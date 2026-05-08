"use client";

import { useState, useRef, useEffect } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AIProviderSelect, type AIProvider } from "@/components/ai-provider-select";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";

interface Paper {
  id: string;
  title: string;
  authors: { name: string }[];
  year?: number;
  venue?: string;
  category?: string | null;
  fullText?: string | null;
  pdfFileName?: string | null;
  citationCount: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PaperAnalysisTabProps {
  projectId: string;
  papers: Paper[];
  aiProvider: AIProvider;
  onProviderChange: (provider: AIProvider) => void;
  onPaperCategoryChange: (paperId: string, category: string | null) => void;
}

const CHAT_QUERY = "__paper_analysis__";

export function PaperAnalysisTab({
  projectId,
  papers,
  aiProvider,
  onProviderChange,
  onPaperCategoryChange,
}: PaperAnalysisTabProps) {
  const NS = `analysis-${projectId}`;

  // Chat state — local state with DB persistence
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexed, setIndexed] = usePersistedState<boolean>(NS, "indexed", false);
  const chatAbort = useAbort();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);

  // Derived lists
  const corePapers = papers.filter((p) => p.category === "core");
  const supportPapers = papers.filter((p) => p.category === "supporting");
  const unclassified = papers.filter((p) => !p.category);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // ── Load chat history from DB on mount ────────────
  useEffect(() => {
    fetch(`/api/chat-history?projectId=${projectId}&query=${encodeURIComponent(CHAT_QUERY)}`)
      .then((r) => r.json())
      .then((data) => {
        const msgs = data.messages as ChatMessage[] | undefined;
        if (msgs && msgs.length > 0) {
          setChatHistory(msgs);
        }
      })
      .catch(() => {})
      .finally(() => setChatLoaded(true));
  }, [projectId]);

  // Auto-index on first visit
  useEffect(() => {
    if (!indexed && papers.length > 0) {
      handleIndex();
    }
  }, [papers.length]);

  // ── Save chat to DB (debounced after streaming completes) ──
  function saveChatToDB(messages: ChatMessage[]) {
    fetch("/api/chat-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        query: CHAT_QUERY,
        messages,
        provider: aiProvider,
      }),
    }).catch(() => {});
  }

  // ── Index papers ──────────────────────────────────
  async function handleIndex() {
    setIndexing(true);
    try {
      const res = await fetch("/api/papers/qa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (res.ok) {
        const data = await res.json();
        setIndexed(true);
        console.log(`[analysis] Indexed ${data.indexed} papers, ${data.totalChunks} chunks`);
      }
    } catch (e) {
      console.error("[analysis] Index failed:", e);
    } finally {
      setIndexing(false);
    }
  }

  // ── Send question ─────────────────────────────────
  async function handleSend() {
    const question = inputValue.trim();
    if (!question || isStreaming) return;

    setInputValue("");
    const userMsg: ChatMessage = { role: "user", content: question };
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };

    setChatHistory((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);
    const signal = chatAbort.reset();

    try {
      const res = await fetch("/api/papers/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          question,
          provider: aiProvider,
          chatHistory: chatHistory.slice(-6),
        }),
        signal,
      });

      if (!res.ok || !res.body) throw new Error("Failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "text") {
              fullText += evt.text;
              setChatHistory((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: fullText };
                return updated;
              });
            }
          } catch { /* skip */ }
        }
      }

      // Save to DB after streaming completes
      setChatHistory((prev) => {
        saveChatToDB(prev);
        return prev;
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setChatHistory((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: "请求失败，请重试。" };
          saveChatToDB(updated);
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
    }
  }

  // ── Clear chat ────────────────────────────────────
  function handleClearChat() {
    setChatHistory([]);
    fetch(`/api/chat-history?projectId=${projectId}&query=${encodeURIComponent(CHAT_QUERY)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  // ── Drag handlers ─────────────────────────────────
  function handleDragStart(paperId: string) {
    setDragId(paperId);
  }

  function handleDrop(category: string | null) {
    if (!dragId) return;
    onPaperCategoryChange(dragId, category);
    setDragId(null);
  }

  // ── Quick suggestions ─────────────────────────────
  const suggestions = [
    "这些文献的主要研究主题和理论框架有哪些？",
    "各文献在研究方法上有什么异同？",
    "这些研究的核心发现之间是否存在矛盾或一致性？",
    "基于这些文献，有哪些尚未被充分探索的研究空白？",
  ];

  const questionCount = chatHistory.filter((m) => m.role === "user").length;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">文献分析工作台</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            拖拽文献分类 · 基于全文的 AI 自由问答 · 对话记录自动保存
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AIProviderSelect value={aiProvider} onChange={onProviderChange} />
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={handleIndex}
            disabled={indexing}
          >
            {indexing ? "索引中..." : indexed ? "重建索引" : "构建索引"}
          </Button>
          {indexed && (
            <Badge variant="secondary" className="text-[10px]">
              已索引 {papers.length} 篇
            </Badge>
          )}
        </div>
      </div>

      {/* ── Paper Classification (Drag & Drop) ── */}
      <div className="grid grid-cols-3 gap-3">
        {/* Core papers zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-3 min-h-[120px] transition-colors ${
            dragId ? "border-teal/50 bg-teal/5" : "border-teal/20"
          }`}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bg-teal/10"); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove("bg-teal/10"); }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("bg-teal/10"); handleDrop("core"); }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-2 h-2 rounded-full bg-teal" />
            <span className="text-xs font-medium text-teal">核心文献</span>
            <Badge variant="secondary" className="text-[10px] ml-auto">{corePapers.length}</Badge>
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {corePapers.map((p) => (
              <PaperChip key={p.id} paper={p} onDragStart={handleDragStart} />
            ))}
          </div>
        </div>

        {/* Supporting papers zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-3 min-h-[120px] transition-colors ${
            dragId ? "border-amber-400/50 bg-amber-50/5" : "border-amber-400/20"
          }`}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bg-amber-50/10"); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove("bg-amber-50/10"); }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("bg-amber-50/10"); handleDrop("supporting"); }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-xs font-medium text-amber-600">支撑文献</span>
            <Badge variant="secondary" className="text-[10px] ml-auto">{supportPapers.length}</Badge>
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {supportPapers.map((p) => (
              <PaperChip key={p.id} paper={p} onDragStart={handleDragStart} />
            ))}
          </div>
        </div>

        {/* Unclassified papers zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-3 min-h-[120px] transition-colors ${
            dragId ? "border-border bg-muted/10" : "border-border/40"
          }`}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bg-muted/20"); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove("bg-muted/20"); }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("bg-muted/20"); handleDrop(null); }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
            <span className="text-xs font-medium text-muted-foreground">未分类</span>
            <Badge variant="secondary" className="text-[10px] ml-auto">{unclassified.length}</Badge>
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {unclassified.map((p) => (
              <PaperChip key={p.id} paper={p} onDragStart={handleDragStart} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Q&A Chat Interface ── */}
      <div className="border border-border/50 rounded-lg overflow-hidden">
        {/* Chat header */}
        <div className="px-4 py-2.5 bg-muted/30 border-b border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">文献问答</span>
            <span className="text-[10px] text-muted-foreground">
              基于 {papers.length} 篇全文 · PaperQA 检索 + LLM 重排序 · 引用溯源
            </span>
            {questionCount > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {questionCount} 条对话
              </Badge>
            )}
          </div>
          {chatHistory.length > 0 && (
            <button
              className="text-[10px] text-muted-foreground hover:text-destructive"
              onClick={handleClearChat}
            >
              清空对话
            </button>
          )}
        </div>

        {/* Chat messages */}
        <div className="max-h-[500px] overflow-y-auto p-4 space-y-4">
          {!chatLoaded ? (
            <div className="text-center py-8">
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <span className="w-3 h-3 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
                加载对话记录...
              </span>
            </div>
          ) : chatHistory.length === 0 && !isStreaming ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-4">
                {indexed
                  ? "文献已索引，可以开始提问。对话记录会自动保存。"
                  : indexing
                    ? "正在构建文献索引..."
                    : "上传 PDF 后即可对文献提问"}
              </p>
              {indexed && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      className="text-xs px-3 py-1.5 rounded-full border border-teal/30 text-teal hover:bg-teal/10 transition-colors"
                      onClick={() => { setInputValue(s); inputRef.current?.focus(); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-teal text-teal-foreground"
                      : "bg-muted/50 border border-border/50"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap leading-relaxed text-foreground/90">
                      {msg.content || (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <span className="w-3 h-3 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
                          正在检索文献...
                        </span>
                      )}
                    </div>
                  ) : (
                    <span>{msg.content}</span>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border/50 p-3 flex gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={indexed ? "输入问题，基于文献库全文回答..." : "请先构建文献索引"}
            disabled={!indexed || isStreaming}
            className="flex-1 resize-none text-sm bg-transparent border border-border/50 rounded-lg px-3 py-2 focus:outline-none focus:border-teal/50 min-h-[40px] max-h-[120px]"
            rows={1}
          />
          <div className="flex flex-col gap-1">
            <Button
              size="sm"
              className="bg-teal text-teal-foreground hover:bg-teal/90 text-xs h-8 px-3"
              onClick={handleSend}
              disabled={!inputValue.trim() || isStreaming || !indexed}
            >
              发送
            </Button>
            <StopButton show={isStreaming} onClick={chatAbort.abort} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Draggable paper chip ────────────────────────────

function PaperChip({
  paper,
  onDragStart,
}: {
  paper: Paper;
  onDragStart: (id: string) => void;
}) {
  const authors = paper.authors?.length
    ? paper.authors.length <= 2
      ? paper.authors.map((a) => a.name).join(" & ")
      : `${paper.authors[0].name} et al.`
    : "";

  return (
    <div
      draggable
      onDragStart={() => onDragStart(paper.id)}
      className="flex items-center gap-1.5 px-2 py-1 rounded bg-background border border-border/50 cursor-grab active:cursor-grabbing hover:border-teal/40 transition-colors text-[10px] group"
      title={paper.title}
    >
      <span className="truncate flex-1 font-medium">{paper.title}</span>
      {paper.year && <span className="text-muted-foreground shrink-0">{paper.year}</span>}
      {authors && <span className="text-muted-foreground truncate max-w-[80px] shrink-0">{authors}</span>}
    </div>
  );
}
