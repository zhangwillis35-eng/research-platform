"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReviewGeneratePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI 文献综述</h1>
        <p className="text-muted-foreground mt-1">
          基于 NotebookLM 全文分析，生成结构化文献综述
        </p>
      </div>

      <Card className="min-h-[400px] flex items-center justify-center">
        <CardContent className="text-center text-muted-foreground">
          <div className="text-4xl mb-4">📝</div>
          <CardHeader className="p-0">
            <CardTitle className="text-base">准备生成综述</CardTitle>
          </CardHeader>
          <p className="text-sm mt-2">
            先添加文献到项目，然后选择核心文献生成综述
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
