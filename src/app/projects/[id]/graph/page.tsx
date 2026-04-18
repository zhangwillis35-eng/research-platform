"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function GraphPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">变量关系知识图谱</h1>
        <p className="text-muted-foreground mt-1">
          可视化文献中的变量关系网络
        </p>
      </div>

      <Card className="min-h-[500px] flex items-center justify-center">
        <CardContent className="text-center text-muted-foreground">
          <div className="text-4xl mb-4">🕸️</div>
          <CardHeader className="p-0">
            <CardTitle className="text-base">图谱待生成</CardTitle>
          </CardHeader>
          <p className="text-sm mt-2">
            添加文献并提取变量关系后，知识图谱将在此展示
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
