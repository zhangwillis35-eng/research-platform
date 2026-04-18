"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function IdeasGeneratePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">研究想法生成</h1>
        <p className="text-muted-foreground mt-1">
          理论 × 情境 × 方法 组合矩阵，AI 评估新颖性
        </p>
      </div>

      <Card className="min-h-[400px] flex items-center justify-center">
        <CardContent className="text-center text-muted-foreground">
          <div className="text-4xl mb-4">💡</div>
          <CardHeader className="p-0">
            <CardTitle className="text-base">准备生成想法</CardTitle>
          </CardHeader>
          <p className="text-sm mt-2">
            先从文献中提取理论、情境和方法维度，然后组合生成研究想法
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
