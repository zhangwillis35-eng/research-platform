import Link from "next/link";

const stats = [
  { label: "文献总数", value: "0", color: "text-teal" },
  { label: "核心文献", value: "0", color: "text-foreground" },
  { label: "研究想法", value: "0", color: "text-foreground" },
  { label: "图谱节点", value: "0", color: "text-foreground" },
];

const steps = [
  { num: "1", text: "前往「文献检索」搜索相关文献", href: "/papers/search" },
  { num: "2", text: "将核心文献添加到项目文献库", href: "/papers" },
  { num: "3", text: "上传 PDF 到 NotebookLM 进行深度分析", href: "" },
  { num: "4", text: "使用「知识图谱」可视化变量关系", href: "/graph" },
  { num: "5", text: "通过「研究想法」生成新的研究方向", href: "/ideas/generate" },
];

export default async function ProjectOverview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-[family-name:var(--font-serif-sc)] text-2xl font-bold">
          项目概览
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          查看研究项目的整体进展
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-6">
        {stats.map((s) => (
          <div key={s.label} className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {s.label}
            </p>
            <p className={`text-3xl font-bold tabular-nums ${s.color}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <hr className="border-border/50" />

      {/* Quick start */}
      <div>
        <h2 className="font-[family-name:var(--font-serif-sc)] text-lg font-semibold mb-4">
          快速开始
        </h2>
        <div className="space-y-3">
          {steps.map((step) => (
            <div key={step.num} className="flex items-baseline gap-4 group">
              <span className="text-sm font-bold text-teal w-5 shrink-0">
                {step.num}
              </span>
              {step.href ? (
                <Link
                  href={`/projects/${id}${step.href}`}
                  className="text-sm text-muted-foreground group-hover:text-foreground transition-colors"
                >
                  {step.text}
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">{step.text}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
