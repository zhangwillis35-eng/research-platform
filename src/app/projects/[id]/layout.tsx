import { CollapsibleSidebar } from "@/components/collapsible-sidebar";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="min-h-screen flex flex-col">
      <CollapsibleSidebar projectId={id} />

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <div className="max-w-[1600px] mx-auto px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
