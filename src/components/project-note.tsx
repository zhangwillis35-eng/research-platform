"use client";

import { useState } from "react";
import { useProjectNote, type NoteSection } from "@/hooks/use-project-note";

interface ProjectNoteProps {
  projectId: string;
  section: NoteSection;
  /** Label shown in the panel header (default: "研究记录") */
  label?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProjectNote({ projectId, section, label = "研究记录" }: ProjectNoteProps) {
  const { content, handleChange, savedAt, saving, loaded } = useProjectNote(projectId, section);
  const [open, setOpen] = useState(false);

  const charCount = content.length;
  const hasContent = charCount > 0;

  return (
    <div className="mt-6 border border-border/60 rounded-xl overflow-hidden bg-background shadow-sm">
      {/* Header — always visible, click to toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">📝 {label}</span>
          {hasContent && !open && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {charCount} 字
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {savedAt && !saving && (
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              已保存 {formatTime(savedAt)}
            </span>
          )}
          {saving && (
            <span className="text-[10px] text-teal animate-pulse">保存中...</span>
          )}
          <span className="text-xs text-muted-foreground">
            {open ? "▲ 收起" : "▼ 展开"}
          </span>
        </div>
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-border/40 px-4 py-3 space-y-2">
          <textarea
            value={loaded ? content : ""}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={`记录您的研究想法、分析思路、待办事项、问题清单等...\n\n支持 Markdown 语法：**粗体** / *斜体* / - 列表项`}
            className="w-full min-h-[180px] resize-y text-sm p-3 border border-input rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-teal/40 focus:border-teal/60 leading-relaxed placeholder:text-muted-foreground/50"
            disabled={!loaded}
            spellCheck={false}
          />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{charCount} 字符</span>
            <div className="flex items-center gap-3">
              {saving && <span className="text-teal">保存中...</span>}
              {savedAt && !saving && <span>上次保存：{formatTime(savedAt)}</span>}
              {hasContent && (
                <button
                  type="button"
                  onClick={() => handleChange("")}
                  className="text-muted-foreground/60 hover:text-destructive transition-colors"
                >
                  清空
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
