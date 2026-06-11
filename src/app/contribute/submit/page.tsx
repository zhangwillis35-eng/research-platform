"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Send, Loader2 } from "lucide-react";
import Link from "next/link";

export default function SubmitStory() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (content.trim().length < 50) {
      setError("请至少写50个字，让 AI 有足够的信息进行分析");
      return;
    }
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "提交失败");
        return;
      }
      router.push(`/contribute/story/${data.id}`);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/contribute/dashboard"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> 返回
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>分享你的职场故事</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-secondary/50 p-4 text-sm text-muted-foreground leading-relaxed">
            请像讲故事一样写下当时发生了什么、谁参与其中、谁影响了谁、大家可能为什么这样反应，
            以及这件事带来了什么影响。你不需要使用学术语言，AI
            会帮助你识别其中的组织行为学现象和理论视角。
          </div>

          <Textarea
            placeholder="在这里描述你观察到的职场现象..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            className="resize-none"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {content.length} 字{" "}
              {content.length < 50 &&
                content.length > 0 &&
                "（至少 50 字）"}
            </span>
            <Button
              onClick={handleSubmit}
              disabled={submitting || content.trim().length < 50}
              className="bg-teal text-teal-foreground hover:bg-teal/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  提交故事
                </>
              )}
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
