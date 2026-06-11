import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "洞察投稿 — ScholarFlow",
  description: "分享你的职场观察，为组织行为学研究贡献真实案例",
};

export default function ContributeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      {/* Simple top bar — no sidebar */}
      <header className="border-b bg-card">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-6 py-4">
          <a href="/contribute" className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight">
              ScholarFlow
            </span>
            <span className="text-xs bg-teal/10 text-teal px-2 py-0.5 rounded-full font-medium">
              洞察投稿
            </span>
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
