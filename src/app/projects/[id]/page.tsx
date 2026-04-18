import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const stats = [
  { label: "文献总数", value: "0", icon: "📄" },
  { label: "核心文献", value: "0", icon: "⭐" },
  { label: "研究想法", value: "0", icon: "💡" },
  { label: "图谱节点", value: "0", icon: "🔗" },
];

export default async function ProjectOverview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">项目概览</h1>
        <p className="text-muted-foreground mt-1">
          查看研究项目的整体进展
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <span className="text-xl">{s.icon}</span>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>快速开始</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>1. 前往「文献检索」搜索相关文献</p>
          <p>2. 将核心文献添加到项目文献库</p>
          <p>3. 上传 PDF 到 NotebookLM 进行深度分析</p>
          <p>4. 使用「知识图谱」可视化变量关系</p>
          <p>5. 通过「研究想法」生成新的研究方向</p>
        </CardContent>
      </Card>
    </div>
  );
}
