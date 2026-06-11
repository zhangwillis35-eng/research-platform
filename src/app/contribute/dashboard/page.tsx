"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PenLine,
  Eye,
  Bookmark,
  Clock,
  CheckCircle2,
  Loader2,
  LogOut,
} from "lucide-react";

interface StoryPreview {
  id: string;
  status: string;
  obCategory: string | null;
  contextType: string | null;
  academicSummary: string | null;
  keyPhenomena: string[] | null;
  rawContent: string;
  viewCount: number;
  bookmarkCount: number;
  createdAt: string;
}

const STATUS_MAP: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  PENDING: {
    label: "等待处理",
    icon: <Clock className="w-3.5 h-3.5" />,
    color: "text-amber-600 bg-amber-50",
  },
  PROCESSING: {
    label: "AI 分析中",
    icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
    color: "text-blue-600 bg-blue-50",
  },
  PUBLISHED: {
    label: "已发布",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    color: "text-teal bg-teal/10",
  },
  REJECTED: {
    label: "未通过",
    icon: <Clock className="w-3.5 h-3.5" />,
    color: "text-destructive bg-destructive/10",
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  leadership: "领导力",
  motivation: "动机",
  team_dynamics: "团队动力",
  organizational_justice: "组织公正",
  conflict: "冲突",
  communication: "沟通",
  power_politics: "权力与政治",
  organizational_culture: "组织文化",
  change_management: "变革管理",
  decision_making: "决策",
  emotions_stress: "情绪与压力",
  diversity_inclusion: "多样性与包容",
  other: "其他",
};

export default function ContributorDashboard() {
  const router = useRouter();
  const [stories, setStories] = useState<StoryPreview[]>([]);
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/contributors/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "me" }),
      }).then((r) => r.json()),
      fetch("/api/stories").then((r) => r.json()),
    ]).then(([me, data]) => {
      setNickname(me.contributor?.nickname || "");
      setStories(data.stories || []);
      setLoading(false);
    });
  }, []);

  async function handleLogout() {
    await fetch("/api/contributors/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/contribute");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">你好，{nickname}</h1>
          <p className="text-sm text-muted-foreground">
            你已投稿 {stories.length} 个故事
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/contribute/submit">
            <Button className="bg-teal text-teal-foreground hover:bg-teal/90">
              <PenLine className="w-4 h-4 mr-2" />
              投稿新故事
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            title="退出"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {stories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            还没有投稿。点击上方按钮分享你的第一个职场故事。
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {stories.map((story) => {
            const status = STATUS_MAP[story.status] || STATUS_MAP.PENDING;
            return (
              <Link key={story.id} href={`/contribute/story/${story.id}`}>
                <Card className="hover:border-teal/30 transition-colors cursor-pointer">
                  <CardContent className="py-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${status.color}`}
                        >
                          {status.icon} {status.label}
                        </span>
                        {story.obCategory && (
                          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full">
                            {CATEGORY_LABELS[story.obCategory] ||
                              story.obCategory}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3 h-3" /> {story.viewCount}
                        </span>
                        <span className="flex items-center gap-1">
                          <Bookmark className="w-3 h-3" /> {story.bookmarkCount}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm line-clamp-2">{story.rawContent}</p>
                    {story.academicSummary && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        学术摘要：{story.academicSummary}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(story.createdAt).toLocaleDateString("zh-CN")}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
