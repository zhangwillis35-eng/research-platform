"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TheoriesIntegratePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">理论整合引擎</h1>
        <p className="text-muted-foreground mt-1">
          发现跨理论连接点，构建整合框架
        </p>
      </div>

      <Card className="min-h-[400px] flex items-center justify-center">
        <CardContent className="text-center text-muted-foreground">
          <div className="text-4xl mb-4">🔬</div>
          <CardHeader className="p-0">
            <CardTitle className="text-base">准备理论分析</CardTitle>
          </CardHeader>
          <p className="text-sm mt-2">
            从文献中识别理论框架，发现跨理论共享构念与连接点
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
