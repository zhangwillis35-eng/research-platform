"use client";

/**
 * AnalysisChat — DB-persisted LLM conversation panel.
 *
 * - Loads chat history from DB on mount (survives browser close/refresh)
 * - Saves to DB after every assistant reply
 * - LLM receives full conversation history for multi-turn context
 * - Collapsible panel with message count badge
 * - "历史记录" expandable section shows all past messages
 */

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";
import type { AIProvider } from "@/components/ai-provider-select";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AnalysisChatProps {
  /** Namespace for state key, e.g. "graph-{projectId}" — also used as DB query key */
  namespace: string;
  /** projectId — required for DB persistence */
  projectId: string;
  /** Current analysis result text to use as context */
  analysisContext: string;
  /** Page-specific system prompt prefix */
  systemPrompt: string;
  /** AI provider to use */
  provider: AIProvider;
  /** Optional: paper titles for reference */
  paperTitles?: string[];
}

export function AnalysisChat({
  namespace,
  projectId,
  analysisContext,
  systemPrompt,
  provider,
  paperTitles,
}: AnalysisChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const abort = useAbort();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Load from DB on mount ──────────────────────────
  useEffect(() => {
    fetch(`/api/chat-history?projectId=${projectId}&query=${encodeURIComponent(namespace)}`)
      .then((r) => r.json())
      .then((d) => {
        const msgs = d.messages as Message[] | undefined;
        if (Array.isArray(msgs) && msgs.length > 0) {
          setMessages(msgs);
          setOpen(true); // auto-open if there's history
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [projectId, namespace]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  // ── Save to DB ─────────────────────────────────────
  async function saveToDb(msgs: Message[]) {
    try {
      await fetch("/api/chat-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, query: namespace, messages: msgs }),
      });
    } catch { /* non-critical */ }
  }

  // ── Send message ───────────────────────────────────
  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    if (!open) setOpen(true);

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    setStreaming(true);
    const signal = abort.reset();
    const assistantIdx = newMessages.length;

    try {
      const paperList = paperTitles?.length
        ? `\n\n## 文献列表\n${paperTitles.map((t, i) => `[${i + 1}] ${t}`).join("\n")}`
        : "";

      const fullSystem = `${systemPrompt}

## 当前分析结果
${analysisContext.slice(0, 12000)}
${paperList}

## 规则
- 用中文回答，学术写作风格
- 引用文献时用 [编号] 标注
- 记住对话上下文，追问时不重复已有内容
- 直接回答问题，不要重复分析结果`;

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          provider,
          system: fullSystem,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      // Add placeholder
      setMessages((prev) => [...prev, { role: "assistant", content: "..." }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.text) {
                accumulated += event.text;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIdx] = { role: "assistant", content: accumulated };
                  return updated;
                });
              }
            } catch { /* skip */ }
          }
        }
      }

      // Save completed conversation to DB
      const finalMessages: Message[] = [
        ...newMessages,
        { role: "assistant", content: accumulated },
      ];
      await saveToDb(finalMessages);
      setMessages(finalMessages);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const errMessages: Message[] = [
          ...newMessages,
          { role: "assistant", content: "请求失败，请重试。" },
        ];
        setMessages(errMessages);
      }
    }
    setStreaming(false);
  }

  async function clearChat() {
    setMessages([]);
    await saveToDb([]);
  }

  const hasMessages = messages.length > 0;
  const msgCount = messages.filter((m) => m.role === "user").length;

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden bg-card shadow-sm mt-6">
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">💬 AI 对话 &amp; 记录</span>
          {hasMessages && (
            <Badge variant="secondary" className="text-[10px] px-1.5">
              {msgCount} 条对话
            </Badge>
          )}
          {!loaded && (
            <span className="text-[10px] text-muted-foreground animate-pulse">加载中...</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{open ? "▲ 收起" : "▼ 展开"}</span>
      </div>

      {open && (
        <>
          {/* ── Messages area ── */}
          {hasMessages && (
            <div
              ref={scrollRef}
              className="border-t border-border/30 max-h-[600px] overflow-y-auto px-4 py-3 space-y-3 bg-muted/5"
            >
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] px-3 py-2 rounded-lg text-xs leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-teal text-white"
                        : "bg-background border border-border/50 text-foreground"
                    }`}
                  >
                    {msg.content === "..." ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <span className="inline-block w-1.5 h-1.5 bg-teal rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="inline-block w-1.5 h-1.5 bg-teal rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="inline-block w-1.5 h-1.5 bg-teal rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </span>
                    ) : (
                      <>
                        {msg.content}
                        {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                          <span className="inline-block w-0.5 h-3 bg-teal ml-0.5 animate-pulse" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Input area ── */}
          <div className="border-t border-border/30 p-3">
            {!hasMessages && loaded && (
              <p className="text-xs text-muted-foreground text-center pb-2">
                对分析结果提问、要求深化或优化 — 对话记录将自动保存，下次打开可继续
              </p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="输入问题或优化意见... (Enter 发送，Shift+Enter 换行)"
                className="flex-1 px-3 py-2 text-xs border border-input rounded-lg bg-background resize-none min-h-[40px] max-h-[100px] focus:outline-none focus:ring-1 focus:ring-teal/40"
                rows={1}
                disabled={streaming}
              />
              <div className="flex flex-col gap-1 shrink-0">
                <Button
                  size="sm"
                  className="h-8 text-xs bg-teal text-white hover:bg-teal/90"
                  onClick={handleSend}
                  disabled={streaming || !input.trim()}
                >
                  发送
                </Button>
                <StopButton show={streaming} onClick={abort.abort} />
              </div>
            </div>
            {hasMessages && (
              <div className="flex justify-end mt-1.5">
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                  onClick={clearChat}
                >
                  清空所有对话记录
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
