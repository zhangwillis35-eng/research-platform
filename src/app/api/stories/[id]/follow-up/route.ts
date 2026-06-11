import { NextResponse } from "next/server";
import { requireContributorAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateFollowUp } from "@/lib/story-processor";

interface FollowUpMessage {
  role: "user" | "assistant";
  content: string;
}

// POST /api/stories/[id]/follow-up — follow-up conversation
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const story = await prisma.story.findUnique({
    where: { id },
    select: { contributorId: true, followUpMessages: true },
  });

  if (!story) {
    return NextResponse.json({ error: "故事不存在" }, { status: 404 });
  }

  if (story.contributorId !== auth.id) {
    return NextResponse.json({ error: "无权操作该故事" }, { status: 403 });
  }

  const { message } = await request.json();

  const existing: FollowUpMessage[] = Array.isArray(story.followUpMessages)
    ? (story.followUpMessages as unknown as FollowUpMessage[])
    : [];

  if (message) {
    existing.push({ role: "user", content: message });
  }

  const aiResponse = await generateFollowUp(id, existing);

  existing.push({ role: "assistant", content: aiResponse });

  await prisma.story.update({
    where: { id },
    data: { followUpMessages: JSON.parse(JSON.stringify(existing)) },
  });

  return NextResponse.json({ reply: aiResponse, messages: existing });
}
