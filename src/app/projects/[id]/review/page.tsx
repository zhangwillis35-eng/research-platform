"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export default function ReviewLandingPage() {
  const params = useParams();
  const projectId = params.id as string;
  const base = `/projects/${projectId}/review`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">文献综述</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          选择综述模式：从零生成初稿，或上传已有初版进行优化
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Link href={`${base}/generate`}>
          <Card className="h-full hover:border-teal/50 hover:shadow-md transition-all cursor-pointer group">
            <CardContent className="p-6 space-y-3">
              <div className="text-3xl">📝</div>
              <h2 className="text-lg font-heading font-bold group-hover:text-teal transition-colors">
                综述初稿生成
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                基于文献库中已上传原文的文献，AI 自动识别研究视角、生成结构化大纲、流式撰写带引文的完整综述。
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal">STORM 多视角</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal">自动大纲</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal">流式撰写</span>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href={`${base}/enhance`}>
          <Card className="h-full hover:border-teal/50 hover:shadow-md transition-all cursor-pointer group">
            <CardContent className="p-6 space-y-3">
              <div className="text-3xl">✎</div>
              <h2 className="text-lg font-heading font-bold group-hover:text-teal transition-colors">
                综述优化
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                上传已有的文献综述初版（Word），AI 分析结构与覆盖度、检索补充文献、制定修改计划、按指令改写并导出 Word。
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">上传 Word</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">Gap 分析</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">修改计划</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">导出 Word</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
