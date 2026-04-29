import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function ProjectOverview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetch real stats from database
  const [paperCount, selectedCount, ideaCount, nodeCount, uploadedCount] =
    await Promise.all([
      prisma.paper.count({ where: { projectId: id } }),
      prisma.paper.count({ where: { projectId: id, isSelected: true } }),
      prisma.researchIdea.count({ where: { projectId: id } }),
      prisma.graphNode.count({ where: { projectId: id } }),
      prisma.paper.count({ where: { projectId: id, fullText: { not: null } } }),
    ]);

  const stats = [
    { label: "文献总数", value: paperCount, color: "text-teal" },
    { label: "已上传原文", value: uploadedCount, color: "text-teal" },
    { label: "研究想法", value: ideaCount, color: "text-foreground" },
    { label: "图谱节点", value: nodeCount, color: "text-foreground" },
  ];

  const steps = [
    { num: "1", text: "前往「文献检索」搜索相关文献", href: "/papers/search" },
    { num: "2", text: "在「文献库」中上传 PDF 文献原文", href: "/papers" },
    { num: "3", text: "使用「文献综述」生成结构化综述", href: "/review/generate" },
    { num: "4", text: "使用「知识图谱」可视化变量关系", href: "/graph" },
    { num: "5", text: "通过「研究想法」生成新的研究方向", href: "/ideas/generate" },
    { num: "6", text: "生成「参考文献」列表（APA/MLA/BibTeX）", href: "/references" },
  ];

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-heading text-2xl font-bold">
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
        <h2 className="font-heading text-lg font-semibold mb-4">
          快速开始
        </h2>
        <div className="space-y-3">
          {steps.map((step) => (
            <div key={step.num} className="flex items-baseline gap-4 group">
              <span className="text-sm font-bold text-teal w-5 shrink-0">
                {step.num}
              </span>
              <Link
                href={`/projects/${id}${step.href}`}
                className="text-sm text-muted-foreground group-hover:text-foreground transition-colors"
              >
                {step.text}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
