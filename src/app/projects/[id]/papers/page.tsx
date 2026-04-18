import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default async function PapersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">文献库</h1>
          <p className="text-muted-foreground mt-1">管理项目中的所有文献</p>
        </div>
        <Link href={`/projects/${id}/papers/search`}>
          <Button>+ 检索文献</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">暂无文献</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>前往「文献检索」搜索并添加文献到此项目</p>
        </CardContent>
      </Card>
    </div>
  );
}
