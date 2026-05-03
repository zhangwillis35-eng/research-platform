"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";
import type { AIProvider } from "@/components/ai-provider-select";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AnalysisChatProps {
  /** Namespace for persisted state (e.g., "graph-{projectId}") */
  namespace: string;
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
  analysisContext,
  systemPrompt,
  provider,
  paperTitles,
}: AnalysisChatProps) {
  const [messages, setMessages] = usePersistedState<Message[]>(namespace, "chatMessages", []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abort = useAbort();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    setStreaming(true);
    const signal = abort.reset();
    const assistantIdx = newMessages.length;

    try {
      // Build context: analysis results + paper list
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

      if (reader) {
        // Add placeholder
        setMessages((prev) => [...prev, { role: "assistant", content: "..." }]);

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
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev.slice(0, assistantIdx),
          { role: "assistant", content: "请求失败，请重试。" },
        ]);
      }
    }
    setStreaming(false);
  }

  function clearChat() {
    setMessages([]);
  }

  return (
    <div className="border border-border/50 rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-muted/30">
        <span className="text-xs font-medium">AI 对话</span>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={clearChat}>
              清空对话
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="max-h-[300px] overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            对生成结果提问、要求优化、或深入探讨
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-xs leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-teal text-white"
                  : "bg-muted/50 text-foreground"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border/30">
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
          placeholder="输入问题或优化意见..."
          className="flex-1 px-2 py-1.5 text-xs border border-input rounded bg-background resize-none h-8 min-h-[32px] max-h-[80px]"
          rows={1}
          disabled={streaming}
        />
        <Button size="sm" className="h-8 text-xs bg-teal text-white hover:bg-teal/90" onClick={handleSend} disabled={streaming || !input.trim()}>
          {streaming ? "生成中..." : "发送"}
        </Button>
        <StopButton show={streaming} onClick={abort.abort} />
      </div>
    </div>
  );
}
