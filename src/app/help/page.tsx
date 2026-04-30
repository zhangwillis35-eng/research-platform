import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HelpPage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <header className="fixed top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="max-w-4xl mx-auto flex h-14 items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-xs font-bold">S</span>
            </div>
            <span className="font-heading text-lg font-bold tracking-tight">
              ScholarFlow
            </span>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              返回首页
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 pt-14">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <h1 className="font-heading text-3xl font-bold tracking-tight mb-2">
            网络兼容性说明
          </h1>
          <p className="text-muted-foreground mb-10">
            ScholarFlow 服务器部署于中国香港。以下信息适用于中国大陆无代理网络环境的用户。
          </p>

          {/* 完全可用 */}
          <section className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
              <h2 className="text-xl font-semibold">无需代理 — 完全可用</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              以下功能的所有请求均通过 ScholarFlow 服务器中转，不受用户本地网络环境限制。
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { name: "注册 / 登录", desc: "邮箱注册、邀请码验证、登录登出" },
                { name: "文献检索", desc: "Semantic Scholar、OpenAlex、Google Scholar (Serper API)、arXiv、CORE、Web of Science" },
                { name: "AI 对话与分析", desc: "DeepSeek、Claude、GPT-4o、Gemini 四大模型" },
                { name: "PDF 上传与存储", desc: "阿里云 OSS 存储，全文提取" },
                { name: "文献综述生成", desc: "AI 结构化综述、主题分析" },
                { name: "知识图谱", desc: "变量关系提取与可视化" },
                { name: "研究想法生成", desc: "理论 x 情境 x 方法组合评估" },
                { name: "理论整合", desc: "理论框架匹配与分析" },
                { name: "概念模型 / Proposal", desc: "模型构建与研究计划生成" },
                { name: "参考文献导出", desc: "APA / MLA / Chicago / BibTeX" },
                { name: "期刊排名查询", desc: "FT50、UTD24、ABS、CCF 等（本地数据）" },
                { name: "Zotero 集成", desc: "文献库同步与引用导入" },
              ].map((item) => (
                <div
                  key={item.name}
                  className="rounded-lg border border-border/60 px-4 py-3"
                >
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 可能受限 */}
          <section className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
              <h2 className="text-xl font-semibold">可能受限 — 浏览器直接访问的外部链接</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              以下场景涉及用户浏览器直接打开外部网站，部分域名在大陆可能无法访问。
            </p>
            <div className="space-y-3">
              {[
                {
                  name: "论文原始链接",
                  desc: "点击论文标题跳转到出版商网站（如部分 Google 域名下的链接）时可能无法打开。",
                  tip: "替代方案：使用 ScholarFlow 内置的 PDF 上传功能，通过 DOI 或其他渠道获取 PDF 后上传。",
                },
                {
                  name: "Connected Papers",
                  desc: "引用网络可视化工具，浏览器直接访问其网站时可能不稳定。",
                  tip: "替代方案：使用 ScholarFlow 内置的知识图谱功能。",
                },
                {
                  name: "Google Scholar 页面链接",
                  desc: "搜索结果中的「在 Google Scholar 中查看」等外链无法打开。",
                  tip: "替代方案：搜索功能本身不受影响（通过服务器代理），仅外链受限。",
                },
              ].map((item) => (
                <div
                  key={item.name}
                  className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3"
                >
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5">{item.tip}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 说明 */}
          <section className="rounded-lg border border-border/60 bg-muted/30 px-5 py-4">
            <h3 className="text-sm font-semibold mb-2">为什么大部分功能不受影响？</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              ScholarFlow 采用服务器端架构：所有 AI 模型调用、学术数据库检索、PDF 存取等操作均在香港服务器上完成，
              用户浏览器只需与 ScholarFlow 服务器通信。因此，即使本地网络无法直接访问 Google、OpenAI 等服务，
              ScholarFlow 的核心功能仍可正常使用。
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t py-8">
        <div className="max-w-4xl mx-auto px-6 text-center text-sm text-muted-foreground">
          ScholarFlow — AI-Powered Research Platform
        </div>
      </footer>
    </div>
  );
}
