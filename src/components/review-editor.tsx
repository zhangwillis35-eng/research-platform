"use client";

/**
 * ReviewEditor — per-section AI editing + global AI chat.
 *
 * Splits review text by ## headings into sections.
 * Each section has an inline AI edit input.
 * Global chat at top can modify the entire review.
 * All chats share the full review context.
 */
import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AIProvider } from "@/components/ai-provider-select";

interface Section {
  id: string;
  heading: string;
  content: string;
  raw: string; // heading + content for reconstruction
}

interface ReviewEditorProps {
  text: string;
  onChange: (text: string) => void;
  provider: AIProvider;
  title?: string;
  onExportWord?: () => void;
}

/** Parse review text into sections by ## headings */
function parseSections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let current: { heading: string; lines: string[]; startIdx: number } | null = null;

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      if (current) {
        const raw = (current.heading ? current.heading + "\n" : "") + current.lines.join("\n");
        sections.push({
          id: `sec-${sections.length}`,
          heading: current.heading.replace(/^#{1,3}\s+/, ""),
          content: current.lines.join("\n").trim(),
          raw,
        });
      }
      current = { heading: line, lines: [], startIdx: sections.length };
    } else {
      if (current) {
        current.lines.push(line);
      } else {
        // Content before any heading
        current = { heading: "", lines: [line], startIdx: 0 };
      }
    }
  }

  if (current) {
    const raw = (current.heading ? current.heading + "\n" : "") + current.lines.join("\n");
    sections.push({
      id: `sec-${sections.length}`,
      heading: current.heading.replace(/^#{1,3}\s+/, ""),
      content: current.lines.join("\n").trim(),
      raw,
    });
  }

  return sections;
}

/** Reconstruct full text from sections */
function rebuildText(sections: Section[]): string {
  return sections.map(s => s.raw).join("\n");
}

export function ReviewEditor({ text, onChange, provider, title, onExportWord }: ReviewEditorProps) {
  const sections = parseSections(text);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [sectionInput, setSectionInput] = useState("");
  const [globalInput, setGlobalInput] = useState("");
  const [globalOpen, setGlobalOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null); // section id or "global"
  const abortRef = useRef<AbortController | null>(null);

  const callAI = useCallback(async (
    instruction: string,
    targetSection: Section | null, // null = global
    signal: AbortSignal,
  ): Promise<string> => {
    const isGlobal = !targetSection;
    const systemPrompt = isGlobal
      ? `你是学术文献综述编辑专家。用户要求你修改整篇综述。请根据用户指令修改全文，输出完整的修改后综述。保留 markdown 格式（## 标题）。用学术中文写作。保留所有 APA 引文。`
      : `你是学术文献综述编辑专家。用户要求你修改综述中的特定章节。以下是完整综述的上下文，但你只需要修改指定章节。输出修改后的章节内容（不含标题，标题由系统自动添加）。保留 APA 引文格式。`;

    const userContent = isGlobal
      ? `## 用户指令\n${instruction}\n\n## 当前综述全文\n${text}`
      : `## 用户指令\n${instruction}\n\n## 需要修改的章节：${targetSection.heading}\n${targetSection.content}\n\n## 完整综述上下文（仅供参考，不要修改其他章节）\n${text}`;

    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
      signal,
    });

    if (!res.body) throw new Error("No response body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.text) fullText += evt.text;
        } catch { /* skip */ }
      }
    }

    return fullText;
  }, [text, provider]);

  const handleSectionEdit = useCallback(async (sectionId: string) => {
    if (!sectionInput.trim() || loading) return;
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(sectionId);

    try {
      const result = await callAI(sectionInput, section, ctrl.signal);
      // Replace just this section's content
      const headingLine = section.raw.split("\n")[0];
      const isHeading = /^#{1,3}\s/.test(headingLine);
      const newRaw = isHeading ? headingLine + "\n\n" + result.trim() : result.trim();
      const newSections = sections.map(s =>
        s.id === sectionId ? { ...s, content: result.trim(), raw: newRaw } : s
      );
      onChange(rebuildText(newSections));
      setSectionInput("");
      setEditingSection(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("Section edit failed:", err);
      }
    } finally {
      setLoading(null);
    }
  }, [sectionInput, loading, sections, callAI, onChange]);

  const handleGlobalEdit = useCallback(async () => {
    if (!globalInput.trim() || loading) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading("global");

    try {
      const result = await callAI(globalInput, null, ctrl.signal);
      onChange(result);
      setGlobalInput("");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("Global edit failed:", err);
      }
    } finally {
      setLoading(null);
    }
  }, [globalInput, loading, callAI, onChange]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setLoading(null);
  }, []);

  return (
    <div className="space-y-3">
      {/* Header with global controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-heading">{title ?? "文献综述"}</CardTitle>
            <div className="flex items-center gap-2">
              {onExportWord && <Button size="sm" variant="outline" className="text-xs h-7" onClick={onExportWord}>导出 Word</Button>}
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => navigator.clipboard.writeText(text)}>复制全文</Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Global AI editor */}
      <Card className="border-teal/40 bg-teal/[0.02]">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between cursor-pointer" onClick={() => setGlobalOpen(!globalOpen)}>
            <CardTitle className="text-sm flex items-center gap-2">
              全文 AI 编辑
              <Badge variant="secondary" className="text-[9px]">最高优先级 · 可调整全文</Badge>
            </CardTitle>
            <span className="text-xs text-muted-foreground">{globalOpen ? "▲ 收起" : "▼ 展开"}</span>
          </div>
        </CardHeader>
        {globalOpen && (
          <CardContent className="pt-0">
            <div className="flex gap-2">
              <textarea
                value={globalInput}
                onChange={(e) => setGlobalInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGlobalEdit(); } }}
                placeholder="输入对全文的修改指令，如「缩短引言部分」「加强理论框架的论述」「调整全文逻辑顺序」..."
                className="flex-1 min-h-[40px] max-h-[100px] resize-y text-xs p-2 border border-input rounded bg-background"
                disabled={loading === "global"}
              />
              <div className="flex flex-col gap-1">
                <Button
                  size="sm"
                  className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs"
                  disabled={!globalInput.trim() || !!loading}
                  onClick={handleGlobalEdit}
                >
                  {loading === "global" ? "修改中..." : "修改全文"}
                </Button>
                {loading === "global" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={handleStop}>停止</Button>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Sections with inline editors */}
      {sections.map((section) => (
        <Card key={section.id} className="group">
          <CardContent className="pt-4 pb-3">
            {/* Section content */}
            {section.heading && (
              <h3 className="font-heading font-semibold text-base mb-2">{section.heading}</h3>
            )}
            <div className="prose prose-sm max-w-none text-foreground leading-relaxed whitespace-pre-wrap text-sm">
              {section.content}
            </div>

            {/* Inline edit trigger / editor */}
            <div className="mt-3 border-t border-border/30 pt-2">
              {editingSection === section.id ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={sectionInput}
                    onChange={(e) => setSectionInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSectionEdit(section.id); if (e.key === "Escape") { setEditingSection(null); setSectionInput(""); } }}
                    placeholder={`修改本段：如「缩短这段」「补充理论依据」「改用更学术的表述」...`}
                    className="flex-1 h-8 px-3 text-xs border border-teal/30 rounded bg-background focus:border-teal focus:ring-1 focus:ring-teal/20"
                    autoFocus
                    disabled={loading === section.id}
                  />
                  <Button
                    size="sm"
                    className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs"
                    disabled={!sectionInput.trim() || !!loading}
                    onClick={() => handleSectionEdit(section.id)}
                  >
                    {loading === section.id ? "修改中..." : "修改"}
                  </Button>
                  {loading === section.id ? (
                    <Button size="sm" variant="outline" className="h-8 text-xs text-destructive" onClick={handleStop}>停止</Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setEditingSection(null); setSectionInput(""); }}>取消</Button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => { setEditingSection(section.id); setSectionInput(""); }}
                  className="text-[10px] text-muted-foreground hover:text-teal transition-colors opacity-0 group-hover:opacity-100"
                >
                  AI 修改本段...
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
