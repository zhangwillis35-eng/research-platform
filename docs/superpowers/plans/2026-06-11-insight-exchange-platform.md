# OB Insight Exchange Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "workplace story contribution" portal for regular employees and a "case library + research question generation" module for researchers, creating a closed loop from real-world observations to academic research inspiration.

**Architecture:** Two-sided platform built into existing ScholarFlow. Contributors get a standalone portal at `/contribute/*` with separate auth (no invite code, simple email+password). Stories go through an AI pipeline (anonymize → academic summary → theory tags). Researchers get a new "案例库" sidebar section at `/projects/[id]/cases` where they can browse published cases, bookmark them, and combine selected cases with their knowledge graph to generate research questions/hypotheses.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (PostgreSQL), DeepSeek V4 Flash (AI processing), shadcn/ui, existing auth patterns extended with `contributor_id` cookie.

---

## File Structure

### New Files

```
prisma/schema.prisma                          — MODIFY: add Contributor, Story, CaseBookmark models + StoryStatus enum

src/middleware.ts                              — MODIFY: allow /contribute/* paths for contributor auth

src/lib/auth.ts                               — MODIFY: add requireContributorAuth() helper

src/lib/story-processor.ts                    — CREATE: AI pipeline (anonymize, summarize, tag)

src/app/contribute/layout.tsx                 — CREATE: contributor portal layout (no sidebar)
src/app/contribute/page.tsx                   — CREATE: landing + login/register
src/app/contribute/dashboard/page.tsx         — CREATE: contributor's story list
src/app/contribute/submit/page.tsx            — CREATE: story submission form + AI follow-up
src/app/contribute/story/[id]/page.tsx        — CREATE: view processed story

src/app/api/contributors/auth/route.ts        — CREATE: register, login, logout, me
src/app/api/stories/route.ts                  — CREATE: list/create stories
src/app/api/stories/[id]/route.ts             — CREATE: get/update/delete story
src/app/api/stories/[id]/process/route.ts     — CREATE: trigger AI processing
src/app/api/stories/[id]/follow-up/route.ts   — CREATE: AI clarification Q&A

src/app/api/cases/route.ts                    — CREATE: list published cases (researcher-facing)
src/app/api/cases/bookmark/route.ts           — CREATE: bookmark/unbookmark cases
src/app/api/cases/generate/route.ts           — CREATE: generate research Qs from cases + graph

src/app/projects/[id]/cases/page.tsx          — CREATE: researcher case library page

src/components/collapsible-sidebar.tsx         — MODIFY: add "案例库" nav item
```

### Dependencies Between Files

- `story-processor.ts` depends on `src/lib/ai/index.ts` (callAI)
- All API routes depend on Prisma schema changes
- Contributor frontend depends on contributor auth API
- Case library page depends on cases API + bookmark API + generate API
- Generate API depends on `story-processor.ts` patterns and existing GraphNode model

---

## Task 1: Database Schema — Contributor, Story, CaseBookmark

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add StoryStatus enum and Contributor model**

Add to `prisma/schema.prisma` after the `JournalFilter` model:

```prisma
// ─── Insight Exchange Platform ──────────────────

enum StoryStatus {
  PENDING     // just submitted, awaiting AI processing
  PROCESSING  // AI pipeline running
  PUBLISHED   // visible to researchers
  REJECTED    // flagged as unsuitable
}

model Contributor {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String   // bcrypt hashed
  nickname  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  stories Story[]
}
```

- [ ] **Step 2: Add Story model**

Add right after the Contributor model:

```prisma
model Story {
  id              String      @id @default(cuid())
  contributorId   String
  rawContent      String      @db.Text // original story text
  status          StoryStatus @default(PENDING)

  // AI-processed fields
  anonymizedContent String?   @db.Text // names/companies replaced
  academicSummary   String?   @db.Text // academic-style abstract
  keyPhenomena      Json?     // ["social loafing", "groupthink", ...]
  theoryTags        Json?     // [{theory, relevance, explanation}]
  obCategory        String?   // "leadership" | "motivation" | "conflict" | ...
  contextType       String?   // "workplace" | "classroom" | "community" | ...

  // AI follow-up conversation
  followUpMessages  Json?     // [{role, content}]

  // Engagement metrics
  viewCount       Int       @default(0)
  bookmarkCount   Int       @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  contributor Contributor   @relation(fields: [contributorId], references: [id], onDelete: Cascade)
  bookmarks   CaseBookmark[]

  @@index([status, createdAt])
  @@index([obCategory])
  @@index([contributorId])
}
```

- [ ] **Step 3: Add CaseBookmark model and update ResearchProject relations**

Add after Story model:

```prisma
model CaseBookmark {
  id        String   @id @default(cuid())
  storyId   String
  projectId String
  userId    String
  note      String?  @db.Text
  createdAt DateTime @default(now())

  story   Story            @relation(fields: [storyId], references: [id], onDelete: Cascade)
  project ResearchProject  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([storyId, projectId, userId])
  @@index([projectId])
}
```

Then add the `bookmarks` relation to the `ResearchProject` model (after the `journalFilters` field):

```prisma
  caseBookmarks  CaseBookmark[]
```

- [ ] **Step 4: Push schema and regenerate client**

```bash
npx prisma db push
npx prisma generate
rm -rf .next
```

Expected: Schema synced, Prisma client regenerated with new types.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add Contributor, Story, CaseBookmark models for insight exchange"
```

---

## Task 2: Middleware & Auth — Contributor Authentication

**Files:**
- Modify: `src/middleware.ts`
- Modify: `src/lib/auth.ts`
- Create: `src/app/api/contributors/auth/route.ts`

- [ ] **Step 1: Update middleware to allow contributor paths**

In `src/middleware.ts`, change the `PUBLIC_PATHS` array and add contributor path handling:

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/admin"];
const AUTH_ONLY_PUBLIC = ["/login"]; // logged-in users should be bounced away
const CONTRIBUTOR_PUBLIC = ["/contribute"]; // login/register page
const CONTRIBUTOR_PROTECTED_PREFIX = "/contribute/"; // dashboard, submit, story/*

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets and API routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const userId = request.cookies.get("user_id")?.value;
  const contributorId = request.cookies.get("contributor_id")?.value;

  // ── Contributor portal ──
  // Landing/login page: allow always, redirect if already logged in
  if (CONTRIBUTOR_PUBLIC.includes(pathname)) {
    if (contributorId) {
      return NextResponse.redirect(new URL("/contribute/dashboard", request.url));
    }
    return NextResponse.next();
  }
  // Protected contributor pages: require contributor cookie
  if (pathname.startsWith(CONTRIBUTOR_PROTECTED_PREFIX)) {
    if (!contributorId) {
      return NextResponse.redirect(new URL("/contribute", request.url));
    }
    return NextResponse.next();
  }

  // ── Researcher portal (existing) ──
  // Redirect logged-in users away from /login
  if (AUTH_ONLY_PUBLIC.includes(pathname) && userId) {
    return NextResponse.redirect(new URL("/projects", request.url));
  }

  // Allow public paths
  if (PUBLIC_PATHS.includes(pathname) || AUTH_ONLY_PUBLIC.includes(pathname)) {
    return NextResponse.next();
  }

  // Require session cookie for all other routes
  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Add contributor auth helpers to auth.ts**

Append to `src/lib/auth.ts`:

```typescript
// ─── Contributor Auth ──────────────────────────

export interface ContributorSession {
  id: string;
  nickname: string;
  email: string;
}

/**
 * Require contributor authentication. Returns the contributor or a 401 Response.
 * Cookie-only check for speed (same pattern as researcher auth).
 */
export async function requireContributorAuth(): Promise<ContributorSession | NextResponse> {
  const cookieStore = await cookies();
  const contributorId = cookieStore.get("contributor_id")?.value;
  if (!contributorId) {
    return NextResponse.json({ error: "请先登录投稿者账号" }, { status: 401 });
  }
  return { id: contributorId, nickname: "", email: "" };
}

/**
 * Like requireContributorAuth, but fetches full contributor info from DB.
 */
export async function requireContributorAuthFull(): Promise<ContributorSession | NextResponse> {
  const cookieStore = await cookies();
  const contributorId = cookieStore.get("contributor_id")?.value;
  if (!contributorId) {
    return NextResponse.json({ error: "请先登录投稿者账号" }, { status: 401 });
  }
  const contributor = await prisma.contributor.findUnique({
    where: { id: contributorId },
    select: { id: true, nickname: true, email: true },
  });
  if (!contributor) {
    return NextResponse.json({ error: "投稿者不存在" }, { status: 401 });
  }
  return contributor;
}
```

- [ ] **Step 3: Create contributor auth API route**

Create `src/app/api/contributors/auth/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  // ── Register ──
  if (action === "register") {
    const { email, password, nickname } = body;
    if (!email || !password || !nickname) {
      return NextResponse.json({ error: "请填写所有字段" }, { status: 400 });
    }
    const existing = await prisma.contributor.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
    }
    const hashed = await bcrypt.hash(password, 10);
    const contributor = await prisma.contributor.create({
      data: { email, password: hashed, nickname },
    });
    const cookieStore = await cookies();
    cookieStore.set("contributor_id", contributor.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: "/",
    });
    return NextResponse.json({ id: contributor.id, nickname: contributor.nickname });
  }

  // ── Login ──
  if (action === "login") {
    const { email, password } = body;
    if (!email || !password) {
      return NextResponse.json({ error: "请填写邮箱和密码" }, { status: 400 });
    }
    const contributor = await prisma.contributor.findUnique({ where: { email } });
    if (!contributor || !(await bcrypt.compare(password, contributor.password))) {
      return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
    }
    const cookieStore = await cookies();
    cookieStore.set("contributor_id", contributor.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });
    return NextResponse.json({ id: contributor.id, nickname: contributor.nickname });
  }

  // ── Logout ──
  if (action === "logout") {
    const cookieStore = await cookies();
    cookieStore.delete("contributor_id");
    return NextResponse.json({ ok: true });
  }

  // ── Me (get current contributor) ──
  if (action === "me") {
    const cookieStore = await cookies();
    const contributorId = cookieStore.get("contributor_id")?.value;
    if (!contributorId) {
      return NextResponse.json({ contributor: null });
    }
    const contributor = await prisma.contributor.findUnique({
      where: { id: contributorId },
      select: { id: true, nickname: true, email: true, createdAt: true },
    });
    return NextResponse.json({ contributor });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
```

- [ ] **Step 4: Verify auth API works**

```bash
# Register
node -e "
const http = require('http');
const data = JSON.stringify({action:'register',email:'test-contrib@example.com',password:'test123456',nickname:'测试投稿者'});
const req = http.request({hostname:'127.0.0.1',port:3000,path:'/api/contributors/auth',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}}, res => {
  let body=''; res.on('data',c=>body+=c); res.on('end',()=>console.log(res.statusCode,body));
});
req.write(data); req.end();
"
```

Expected: `200 {"id":"c...","nickname":"测试投稿者"}`

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts src/lib/auth.ts src/app/api/contributors/auth/route.ts
git commit -m "feat(auth): add contributor authentication system"
```

---

## Task 3: AI Story Processing Pipeline

**Files:**
- Create: `src/lib/story-processor.ts`

- [ ] **Step 1: Create the story processor module**

Create `src/lib/story-processor.ts`:

```typescript
import { callAI } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { setAIContext } from "@/lib/ai";

/**
 * Full AI processing pipeline for a submitted story.
 * 1. Anonymize personal identifiers
 * 2. Generate academic summary
 * 3. Extract OB phenomena + theory tags
 * 4. Classify category and context type
 */
export async function processStory(storyId: string): Promise<void> {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story || story.status !== "PENDING") return;

  await prisma.story.update({
    where: { id: storyId },
    data: { status: "PROCESSING" },
  });

  try {
    setAIContext("system", "story-processor");

    // Step 1: Anonymize
    const anonymized = await anonymizeStory(story.rawContent);

    // Step 2: Academic summary + theory tags + classification (single call for efficiency)
    const analysis = await analyzeStory(anonymized);

    await prisma.story.update({
      where: { id: storyId },
      data: {
        status: "PUBLISHED",
        anonymizedContent: anonymized,
        academicSummary: analysis.academicSummary,
        keyPhenomena: analysis.keyPhenomena,
        theoryTags: analysis.theoryTags,
        obCategory: analysis.obCategory,
        contextType: analysis.contextType,
      },
    });
  } catch (error) {
    console.error(`[story-processor] Failed to process story ${storyId}:`, error);
    // Revert to PENDING so it can be retried
    await prisma.story.update({
      where: { id: storyId },
      data: { status: "PENDING" },
    });
    throw error;
  }
}

async function anonymizeStory(rawContent: string): Promise<string> {
  const res = await callAI({
    provider: "deepseek-fast",
    messages: [{ role: "user", content: rawContent }],
    system: `You are a text anonymizer for organizational behavior research.
Replace all personal names with pseudonyms (Person A, Person B, etc.).
Replace company names with generic labels (Company X, Department Y, etc.).
Replace specific locations with generic descriptions.
Preserve the narrative structure, emotional tone, and all behavioral details.
Return ONLY the anonymized text, nothing else.`,
    temperature: 0.1,
    noThinking: true,
  });
  return res.content;
}

interface StoryAnalysis {
  academicSummary: string;
  keyPhenomena: string[];
  theoryTags: Array<{ theory: string; relevance: string; explanation: string }>;
  obCategory: string;
  contextType: string;
}

async function analyzeStory(anonymizedContent: string): Promise<StoryAnalysis> {
  const res = await callAI({
    provider: "deepseek-fast",
    messages: [{ role: "user", content: anonymizedContent }],
    system: `You are an organizational behavior scholar analyzing a real-world workplace story.
Produce a JSON object with these fields:
{
  "academicSummary": "A 150-200 word academic abstract describing the observed phenomena, theoretical implications, and potential research value. Use formal academic language.",
  "keyPhenomena": ["list of 3-6 OB phenomena observed, e.g. social loafing, psychological safety, transformational leadership"],
  "theoryTags": [
    {"theory": "Theory name", "relevance": "high|medium|low", "explanation": "One sentence on why this theory applies"}
  ],
  "obCategory": "one of: leadership, motivation, team_dynamics, organizational_justice, conflict, communication, power_politics, organizational_culture, change_management, decision_making, emotions_stress, diversity_inclusion, other",
  "contextType": "one of: corporate, startup, government, education, healthcare, nonprofit, military, remote_work, cross_cultural, other"
}
Identify 2-5 relevant theories. Be precise and grounded in established OB literature.`,
    temperature: 0.3,
    jsonMode: true,
    noThinking: true,
  });

  return JSON.parse(res.content);
}

/**
 * Generate an AI follow-up question to elicit richer detail from the contributor.
 */
export async function generateFollowUp(
  storyId: string,
  existingMessages: Array<{ role: string; content: string }>
): Promise<string> {
  setAIContext("system", "story-followup");

  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) throw new Error("Story not found");

  const res = await callAI({
    provider: "deepseek-fast",
    messages: [
      { role: "user", content: `Original story:\n${story.rawContent}` },
      ...existingMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ],
    system: `You are a friendly research assistant helping a contributor enrich their workplace story.
Ask ONE focused follow-up question to elicit details that would be valuable for organizational behavior research.
Focus on: interpersonal dynamics, emotional reactions, power structures, decision processes, or outcomes.
Be warm and conversational — the contributor is not an academic. Respond in Chinese.
If the story already has rich detail (after 2+ exchanges), say "感谢您的分享！您提供的信息已经非常丰富了。" and stop asking.`,
    temperature: 0.6,
    noThinking: true,
  });

  return res.content;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/story-processor.ts
git commit -m "feat: add AI story processing pipeline (anonymize, summarize, tag)"
```

---

## Task 4: Story CRUD API Routes

**Files:**
- Create: `src/app/api/stories/route.ts`
- Create: `src/app/api/stories/[id]/route.ts`
- Create: `src/app/api/stories/[id]/process/route.ts`
- Create: `src/app/api/stories/[id]/follow-up/route.ts`

- [ ] **Step 1: Create stories list/create route**

Create `src/app/api/stories/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireContributorAuth } from "@/lib/auth";
import { processStory } from "@/lib/story-processor";

// GET — list contributor's own stories
export async function GET(req: NextRequest) {
  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const stories = await prisma.story.findMany({
    where: { contributorId: auth.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      obCategory: true,
      contextType: true,
      academicSummary: true,
      keyPhenomena: true,
      theoryTags: true,
      viewCount: true,
      bookmarkCount: true,
      createdAt: true,
      // rawContent preview (first 100 chars)
      rawContent: true,
    },
  });

  // Truncate rawContent to preview
  const previewed = stories.map((s) => ({
    ...s,
    rawContent: s.rawContent.slice(0, 100) + (s.rawContent.length > 100 ? "..." : ""),
  }));

  return NextResponse.json({ stories: previewed });
}

// POST — submit a new story
export async function POST(req: NextRequest) {
  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const { content } = await req.json();
  if (!content || content.trim().length < 50) {
    return NextResponse.json({ error: "故事内容至少需要50个字符" }, { status: 400 });
  }

  const story = await prisma.story.create({
    data: {
      contributorId: auth.id,
      rawContent: content.trim(),
    },
  });

  // Trigger AI processing in background (don't await)
  processStory(story.id).catch((err) =>
    console.error("[stories] Background processing failed:", err)
  );

  return NextResponse.json({ id: story.id, status: "PENDING" });
}
```

- [ ] **Step 2: Create single story route**

Create `src/app/api/stories/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireContributorAuth } from "@/lib/auth";

// GET — get story detail (owner only)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const story = await prisma.story.findUnique({ where: { id } });

  if (!story || story.contributorId !== auth.id) {
    return NextResponse.json({ error: "未找到该故事" }, { status: 404 });
  }

  return NextResponse.json({ story });
}

// DELETE — delete own story
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const story = await prisma.story.findUnique({
    where: { id },
    select: { contributorId: true },
  });

  if (!story || story.contributorId !== auth.id) {
    return NextResponse.json({ error: "未找到该故事" }, { status: 404 });
  }

  await prisma.story.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Create process trigger route**

Create `src/app/api/stories/[id]/process/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireContributorAuth } from "@/lib/auth";
import { processStory } from "@/lib/story-processor";

// POST — manually re-trigger processing
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const story = await prisma.story.findUnique({
    where: { id },
    select: { contributorId: true, status: true },
  });

  if (!story || story.contributorId !== auth.id) {
    return NextResponse.json({ error: "未找到该故事" }, { status: 404 });
  }

  if (story.status === "PROCESSING") {
    return NextResponse.json({ error: "正在处理中，请稍候" }, { status: 409 });
  }

  // Reset to PENDING and reprocess
  await prisma.story.update({ where: { id }, data: { status: "PENDING" } });
  processStory(id).catch((err) =>
    console.error("[stories] Re-processing failed:", err)
  );

  return NextResponse.json({ ok: true, status: "PENDING" });
}
```

- [ ] **Step 4: Create follow-up conversation route**

Create `src/app/api/stories/[id]/follow-up/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireContributorAuth } from "@/lib/auth";
import { generateFollowUp } from "@/lib/story-processor";

// POST — send a message in the follow-up conversation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireContributorAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { message } = await req.json();

  const story = await prisma.story.findUnique({ where: { id } });
  if (!story || story.contributorId !== auth.id) {
    return NextResponse.json({ error: "未找到该故事" }, { status: 404 });
  }

  const existing = (story.followUpMessages as Array<{ role: string; content: string }>) || [];

  // If user sent a message, add it
  if (message) {
    existing.push({ role: "user", content: message });
  }

  // Generate AI response
  const aiResponse = await generateFollowUp(id, existing);
  existing.push({ role: "assistant", content: aiResponse });

  await prisma.story.update({
    where: { id },
    data: { followUpMessages: existing },
  });

  return NextResponse.json({ reply: aiResponse, messages: existing });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/stories/
git commit -m "feat(api): add story CRUD, processing trigger, and follow-up routes"
```

---

## Task 5: Contributor Portal — Layout & Landing Page

**Files:**
- Create: `src/app/contribute/layout.tsx`
- Create: `src/app/contribute/page.tsx`

- [ ] **Step 1: Create contributor layout**

Create `src/app/contribute/layout.tsx`:

```tsx
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
```

- [ ] **Step 2: Create landing/login/register page**

Create `src/app/contribute/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff } from "lucide-react";

type Mode = "intro" | "login" | "register";

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default function ContributeLanding() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("intro");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const action = mode === "login" ? "login" : "register";
      const body: Record<string, string> = { action, email, password };
      if (mode === "register") body.nickname = nickname;

      const res = await fetch("/api/contributors/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "操作失败");
        return;
      }
      router.push("/contribute/dashboard");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "intro") {
    return (
      <div className="space-y-8 pt-8">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold tracking-tight">
            分享你的职场洞察
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto leading-relaxed">
            请描述一个你在组织、团队、课堂、社群或工作场景中观察到的真实互动事件。
            它可以是一次沉默、附和、劝说、冲突、服从、态度改变、不公平感，
            或任何让你觉得"人在群体中为什么会这样做"的瞬间。
          </p>
        </div>

        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6 space-y-3">
            <Button
              className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              onClick={() => setMode("register")}
            >
              注册投稿账号
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setMode("login")}
            >
              已有账号，直接登录
            </Button>
          </CardContent>
        </Card>

        <div className="text-center text-sm text-muted-foreground">
          <p>你的故事将经过 AI 匿名化处理，隐去所有真实姓名和组织信息。</p>
          <p>研究者只能看到匿名化后的学术摘要和理论标签。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-8 max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>
            {mode === "login" ? "登录" : "注册"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <Input
                placeholder="昵称（其他人看不到）"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
            )}
            <Input
              type="email"
              placeholder="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              disabled={loading}
            >
              {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
              className="w-full text-sm text-muted-foreground hover:text-foreground"
            >
              {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/contribute/layout.tsx src/app/contribute/page.tsx
git commit -m "feat: add contributor portal layout and landing page"
```

---

## Task 6: Contributor Dashboard & Submit Pages

**Files:**
- Create: `src/app/contribute/dashboard/page.tsx`
- Create: `src/app/contribute/submit/page.tsx`
- Create: `src/app/contribute/story/[id]/page.tsx`

- [ ] **Step 1: Create contributor dashboard**

Create `src/app/contribute/dashboard/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PenLine, Eye, Bookmark, Clock, CheckCircle2, Loader2, LogOut } from "lucide-react";

interface StoryPreview {
  id: string;
  status: string;
  obCategory: string | null;
  contextType: string | null;
  academicSummary: string | null;
  keyPhenomena: string[] | null;
  rawContent: string;
  viewCount: number;
  bookmarkCount: number;
  createdAt: string;
}

const STATUS_MAP: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  PENDING: { label: "等待处理", icon: <Clock className="w-3.5 h-3.5" />, color: "text-amber-600 bg-amber-50" },
  PROCESSING: { label: "AI 分析中", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, color: "text-blue-600 bg-blue-50" },
  PUBLISHED: { label: "已发布", icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "text-teal bg-teal/10" },
  REJECTED: { label: "未通过", icon: <Clock className="w-3.5 h-3.5" />, color: "text-destructive bg-destructive/10" },
};

const CATEGORY_LABELS: Record<string, string> = {
  leadership: "领导力",
  motivation: "动机",
  team_dynamics: "团队动力",
  organizational_justice: "组织公正",
  conflict: "冲突",
  communication: "沟通",
  power_politics: "权力与政治",
  organizational_culture: "组织文化",
  change_management: "变革管理",
  decision_making: "决策",
  emotions_stress: "情绪与压力",
  diversity_inclusion: "多样性与包容",
  other: "其他",
};

export default function ContributorDashboard() {
  const router = useRouter();
  const [stories, setStories] = useState<StoryPreview[]>([]);
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/contributors/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "me" }),
      }).then((r) => r.json()),
      fetch("/api/stories").then((r) => r.json()),
    ]).then(([me, data]) => {
      setNickname(me.contributor?.nickname || "");
      setStories(data.stories || []);
      setLoading(false);
    });
  }, []);

  async function handleLogout() {
    await fetch("/api/contributors/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/contribute");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">你好，{nickname}</h1>
          <p className="text-sm text-muted-foreground">
            你已投稿 {stories.length} 个故事
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/contribute/submit">
            <Button className="bg-teal text-teal-foreground hover:bg-teal/90">
              <PenLine className="w-4 h-4 mr-2" />
              投稿新故事
            </Button>
          </Link>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="退出">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stories list */}
      {stories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            还没有投稿。点击上方按钮分享你的第一个职场故事。
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {stories.map((story) => {
            const status = STATUS_MAP[story.status] || STATUS_MAP.PENDING;
            return (
              <Link key={story.id} href={`/contribute/story/${story.id}`}>
                <Card className="hover:border-teal/30 transition-colors cursor-pointer">
                  <CardContent className="py-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${status.color}`}>
                          {status.icon} {status.label}
                        </span>
                        {story.obCategory && (
                          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full">
                            {CATEGORY_LABELS[story.obCategory] || story.obCategory}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3 h-3" /> {story.viewCount}
                        </span>
                        <span className="flex items-center gap-1">
                          <Bookmark className="w-3 h-3" /> {story.bookmarkCount}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm line-clamp-2">{story.rawContent}</p>
                    {story.academicSummary && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        学术摘要：{story.academicSummary}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(story.createdAt).toLocaleDateString("zh-CN")}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create story submission page**

Create `src/app/contribute/submit/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Send, Loader2 } from "lucide-react";
import Link from "next/link";

export default function SubmitStory() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (content.trim().length < 50) {
      setError("请至少写50个字，让 AI 有足够的信息进行分析");
      return;
    }
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "提交失败");
        return;
      }
      router.push(`/contribute/story/${data.id}`);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/contribute/dashboard"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> 返回
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>分享你的职场故事</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-secondary/50 p-4 text-sm text-muted-foreground leading-relaxed">
            请像讲故事一样写下当时发生了什么、谁参与其中、谁影响了谁、大家可能为什么这样反应，
            以及这件事带来了什么影响。你不需要使用学术语言，AI 会帮助你识别其中的组织行为学现象和理论视角。
          </div>

          <Textarea
            placeholder="在这里描述你观察到的职场现象..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            className="resize-none"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {content.length} 字 {content.length < 50 && content.length > 0 && "（至少 50 字）"}
            </span>
            <Button
              onClick={handleSubmit}
              disabled={submitting || content.trim().length < 50}
              className="bg-teal text-teal-foreground hover:bg-teal/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  提交故事
                </>
              )}
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create story detail page with follow-up chat**

Create `src/app/contribute/story/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft, Loader2, CheckCircle2, Clock, RefreshCw, Send, Trash2, Tag,
} from "lucide-react";
import { useRouter } from "next/navigation";

interface Story {
  id: string;
  rawContent: string;
  status: string;
  anonymizedContent: string | null;
  academicSummary: string | null;
  keyPhenomena: string[] | null;
  theoryTags: Array<{ theory: string; relevance: string; explanation: string }> | null;
  obCategory: string | null;
  contextType: string | null;
  followUpMessages: Array<{ role: string; content: string }> | null;
  viewCount: number;
  bookmarkCount: number;
  createdAt: string;
}

export default function StoryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  function fetchStory() {
    fetch(`/api/stories/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setStory(data.story);
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchStory();
    // Poll while processing
    const interval = setInterval(() => {
      fetch(`/api/stories/${id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.story) setStory(data.story);
          if (data.story?.status !== "PROCESSING") clearInterval(interval);
        });
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleFollowUp() {
    if (!chatInput.trim()) return;
    setChatLoading(true);
    try {
      const res = await fetch(`/api/stories/${id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput }),
      });
      const data = await res.json();
      if (story) {
        setStory({ ...story, followUpMessages: data.messages });
      }
      setChatInput("");
    } finally {
      setChatLoading(false);
    }
  }

  async function handleStartChat() {
    setChatLoading(true);
    try {
      const res = await fetch(`/api/stories/${id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (story) {
        setStory({ ...story, followUpMessages: data.messages });
      }
    } finally {
      setChatLoading(false);
    }
  }

  async function handleReprocess() {
    setReprocessing(true);
    await fetch(`/api/stories/${id}/process`, { method: "POST" });
    fetchStory();
    setReprocessing(false);
  }

  async function handleDelete() {
    if (!confirm("确定删除这个故事？此操作不可撤销。")) return;
    await fetch(`/api/stories/${id}`, { method: "DELETE" });
    router.push("/contribute/dashboard");
  }

  if (loading || !story) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isProcessing = story.status === "PROCESSING";
  const isPublished = story.status === "PUBLISHED";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/contribute/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> 返回
        </Link>
        <div className="flex gap-2">
          {!isProcessing && (
            <Button variant="outline" size="sm" onClick={handleReprocess} disabled={reprocessing}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${reprocessing ? "animate-spin" : ""}`} />
              重新分析
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleDelete} className="text-destructive hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5 mr-1" /> 删除
          </Button>
        </div>
      </div>

      {/* Original story */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            你的故事
            {isProcessing && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
            {isPublished && <CheckCircle2 className="w-4 h-4 text-teal" />}
            {story.status === "PENDING" && <Clock className="w-4 h-4 text-amber-500" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{story.rawContent}</p>
          <p className="text-xs text-muted-foreground mt-3">
            提交于 {new Date(story.createdAt).toLocaleString("zh-CN")}
          </p>
        </CardContent>
      </Card>

      {/* AI Analysis Results */}
      {isPublished && (
        <>
          {story.academicSummary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">学术摘要</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{story.academicSummary}</p>
              </CardContent>
            </Card>
          )}

          {story.theoryTags && story.theoryTags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Tag className="w-4 h-4" /> 理论标签
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {story.theoryTags.map((tag, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full mt-0.5 shrink-0 ${
                      tag.relevance === "high" ? "bg-teal/10 text-teal" :
                      tag.relevance === "medium" ? "bg-amber-50 text-amber-600" :
                      "bg-secondary text-muted-foreground"
                    }`}>
                      {tag.theory}
                    </span>
                    <span className="text-sm text-muted-foreground">{tag.explanation}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {story.keyPhenomena && story.keyPhenomena.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {story.keyPhenomena.map((p, i) => (
                <span key={i} className="text-xs bg-secondary px-2.5 py-1 rounded-full">
                  {p}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {isProcessing && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
            <p>AI 正在分析你的故事，通常需要 10-30 秒...</p>
          </CardContent>
        </Card>
      )}

      {/* Follow-up conversation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 对话补充</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!story.followUpMessages || story.followUpMessages.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">
                AI 可以向你提问，帮助补充更多细节，让故事对研究者更有价值。
              </p>
              <Button variant="outline" size="sm" onClick={handleStartChat} disabled={chatLoading}>
                {chatLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                开始对话
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {story.followUpMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-sm p-3 rounded-lg ${
                      msg.role === "assistant"
                        ? "bg-secondary"
                        : "bg-teal/5 ml-8"
                    }`}
                  >
                    {msg.content}
                  </div>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleFollowUp();
                }}
                className="flex gap-2"
              >
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="回复 AI 的提问..."
                  disabled={chatLoading}
                />
                <Button type="submit" size="icon" disabled={chatLoading || !chatInput.trim()}>
                  {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/contribute/dashboard/page.tsx src/app/contribute/submit/page.tsx src/app/contribute/story/
git commit -m "feat: add contributor dashboard, submit, and story detail pages"
```

---

## Task 7: Researcher Case Library API

**Files:**
- Create: `src/app/api/cases/route.ts`
- Create: `src/app/api/cases/bookmark/route.ts`
- Create: `src/app/api/cases/generate/route.ts`

- [ ] **Step 1: Create cases listing API (researcher-facing)**

Create `src/app/api/cases/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// GET — list published cases for researchers
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const contextType = url.searchParams.get("contextType");
  const search = url.searchParams.get("q");
  const projectId = url.searchParams.get("projectId");
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 20;

  const where: Record<string, unknown> = { status: "PUBLISHED" };
  if (category) where.obCategory = category;
  if (contextType) where.contextType = contextType;
  if (search) {
    where.OR = [
      { academicSummary: { contains: search, mode: "insensitive" } },
      { anonymizedContent: { contains: search, mode: "insensitive" } },
    ];
  }

  const [cases, total] = await Promise.all([
    prisma.story.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        anonymizedContent: true,
        academicSummary: true,
        keyPhenomena: true,
        theoryTags: true,
        obCategory: true,
        contextType: true,
        viewCount: true,
        bookmarkCount: true,
        createdAt: true,
        bookmarks: projectId
          ? { where: { projectId, userId: auth.id }, select: { id: true } }
          : false,
      },
    }),
    prisma.story.count({ where }),
  ]);

  // Increment view count for returned stories
  const ids = cases.map((c) => c.id);
  if (ids.length > 0) {
    await prisma.story.updateMany({
      where: { id: { in: ids } },
      data: { viewCount: { increment: 1 } },
    });
  }

  return NextResponse.json({
    cases: cases.map((c) => ({
      ...c,
      isBookmarked: Array.isArray(c.bookmarks) && c.bookmarks.length > 0,
      bookmarks: undefined, // Strip raw bookmark data
    })),
    total,
    page,
    pageSize,
  });
}
```

- [ ] **Step 2: Create bookmark API**

Create `src/app/api/cases/bookmark/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";

// POST — toggle bookmark
export async function POST(req: NextRequest) {
  const { storyId, projectId, note } = await req.json();

  if (!storyId || !projectId) {
    return NextResponse.json({ error: "Missing storyId or projectId" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  // Check if already bookmarked
  const existing = await prisma.caseBookmark.findUnique({
    where: { storyId_projectId_userId: { storyId, projectId, userId: auth.id } },
  });

  if (existing) {
    // Un-bookmark
    await prisma.caseBookmark.delete({ where: { id: existing.id } });
    await prisma.story.update({
      where: { id: storyId },
      data: { bookmarkCount: { decrement: 1 } },
    });
    return NextResponse.json({ bookmarked: false });
  } else {
    // Bookmark
    await prisma.caseBookmark.create({
      data: { storyId, projectId, userId: auth.id, note },
    });
    await prisma.story.update({
      where: { id: storyId },
      data: { bookmarkCount: { increment: 1 } },
    });
    return NextResponse.json({ bookmarked: true });
  }
}
```

- [ ] **Step 3: Create research question generation API**

Create `src/app/api/cases/generate/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { callAI } from "@/lib/ai";
import { setAIContext } from "@/lib/ai";

// POST — generate research questions from selected cases + knowledge graph
export async function POST(req: NextRequest) {
  const { projectId, storyIds } = await req.json();

  if (!projectId || !storyIds?.length) {
    return NextResponse.json({ error: "请选择至少一个案例" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if (auth instanceof NextResponse) return auth;

  setAIContext(auth.id, "cases-generate");

  // Fetch selected stories
  const stories = await prisma.story.findMany({
    where: { id: { in: storyIds }, status: "PUBLISHED" },
    select: {
      anonymizedContent: true,
      academicSummary: true,
      keyPhenomena: true,
      theoryTags: true,
      obCategory: true,
    },
  });

  // Fetch the project's knowledge graph (if any)
  const [nodes, edges] = await Promise.all([
    prisma.graphNode.findMany({
      where: { projectId },
      select: { label: true, nodeType: true, frequency: true },
      orderBy: { frequency: "desc" },
      take: 30,
    }),
    prisma.graphEdge.findMany({
      where: { projectId },
      select: {
        fromNode: { select: { label: true } },
        toNode: { select: { label: true } },
        relationType: true,
        direction: true,
        weight: true,
      },
      orderBy: { weight: "desc" },
      take: 30,
    }),
  ]);

  // Build context
  const caseSummaries = stories
    .map(
      (s, i) =>
        `Case ${i + 1} [${s.obCategory}]:
Summary: ${s.academicSummary}
Phenomena: ${(s.keyPhenomena as string[])?.join(", ")}
Theories: ${(s.theoryTags as Array<{ theory: string }>)?.map((t) => t.theory).join(", ")}`
    )
    .join("\n\n");

  let graphContext = "";
  if (nodes.length > 0) {
    const nodeList = nodes.map((n) => `${n.label} (${n.nodeType}, freq=${n.frequency})`).join("; ");
    const edgeList = edges
      .map((e) => `${e.fromNode.label} → ${e.toNode.label} (${e.relationType}, ${e.direction})`)
      .join("; ");
    graphContext = `\n\nResearcher's Knowledge Graph:\nVariables: ${nodeList}\nRelationships: ${edgeList}`;
  }

  const res = await callAI({
    provider: "deepseek-fast",
    messages: [
      {
        role: "user",
        content: `Selected real-world cases:\n\n${caseSummaries}${graphContext}`,
      },
    ],
    system: `You are a senior organizational behavior scholar generating research questions from real-world cases.
Given the submitted cases (and optionally the researcher's existing knowledge graph), generate research ideas.

Return a JSON array of 3-5 research ideas, each with:
{
  "title": "Research question as a concise title",
  "researchQuestion": "Formal research question (RQ)",
  "hypotheses": ["H1: ...", "H2: ..."],
  "theoreticalBasis": "Which theories from the cases (and graph) inform this",
  "methodology": "Suggested research design (survey, experiment, qualitative, etc.)",
  "caseLink": "How specific cases inspired this question",
  "novelty": "What makes this question worth studying"
}

Focus on questions that:
1. Bridge the gap between practitioner observations and academic theory
2. Are testable and publishable in top OB journals (AMJ, ASQ, JAP, OBaHDP)
3. Connect phenomena from multiple cases when possible
4. Leverage the researcher's existing knowledge graph variables if available`,
    jsonMode: true,
    noThinking: true,
    temperature: 0.5,
    timeoutMs: 60000,
  });

  const ideas = JSON.parse(res.content);
  return NextResponse.json({ ideas, usage: res.usage });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cases/
git commit -m "feat(api): add case listing, bookmark, and research question generation"
```

---

## Task 8: Researcher Case Library Page

**Files:**
- Create: `src/app/projects/[id]/cases/page.tsx`
- Modify: `src/components/collapsible-sidebar.tsx`

- [ ] **Step 1: Create the case library page**

Create `src/app/projects/[id]/cases/page.tsx`:

```tsx
"use client";

import { useEffect, useState, use } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Bookmark, BookmarkCheck, Search, Loader2, Lightbulb, Tag,
  ChevronDown, ChevronUp, Filter,
} from "lucide-react";

interface CaseItem {
  id: string;
  anonymizedContent: string | null;
  academicSummary: string | null;
  keyPhenomena: string[] | null;
  theoryTags: Array<{ theory: string; relevance: string; explanation: string }> | null;
  obCategory: string | null;
  contextType: string | null;
  viewCount: number;
  bookmarkCount: number;
  isBookmarked: boolean;
  createdAt: string;
}

interface GeneratedIdea {
  title: string;
  researchQuestion: string;
  hypotheses: string[];
  theoreticalBasis: string;
  methodology: string;
  caseLink: string;
  novelty: string;
}

const CATEGORIES = [
  { value: "", label: "全部分类" },
  { value: "leadership", label: "领导力" },
  { value: "motivation", label: "动机" },
  { value: "team_dynamics", label: "团队动力" },
  { value: "organizational_justice", label: "组织公正" },
  { value: "conflict", label: "冲突" },
  { value: "communication", label: "沟通" },
  { value: "power_politics", label: "权力与政治" },
  { value: "organizational_culture", label: "组织文化" },
  { value: "change_management", label: "变革管理" },
  { value: "decision_making", label: "决策" },
  { value: "emotions_stress", label: "情绪与压力" },
  { value: "diversity_inclusion", label: "多样性与包容" },
];

const CONTEXT_TYPES = [
  { value: "", label: "全部场景" },
  { value: "corporate", label: "企业" },
  { value: "startup", label: "创业公司" },
  { value: "government", label: "政府机关" },
  { value: "education", label: "教育" },
  { value: "healthcare", label: "医疗" },
  { value: "nonprofit", label: "非营利" },
  { value: "remote_work", label: "远程办公" },
  { value: "cross_cultural", label: "跨文化" },
];

export default function CaseLibrary({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);

  const [cases, setCases] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [contextType, setContextType] = useState("");

  // Selection for idea generation
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [ideas, setIdeas] = useState<GeneratedIdea[]>([]);

  // Expanded case
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function fetchCases(p = 1) {
    setLoading(true);
    const params = new URLSearchParams({ projectId, page: String(p) });
    if (category) params.set("category", category);
    if (contextType) params.set("contextType", contextType);
    if (search) params.set("q", search);

    fetch(`/api/cases?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setCases(data.cases || []);
        setTotal(data.total || 0);
        setPage(p);
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchCases(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, contextType]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchCases(1);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleBookmark(storyId: string) {
    const res = await fetch("/api/cases/bookmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyId, projectId }),
    });
    const data = await res.json();
    setCases((prev) =>
      prev.map((c) =>
        c.id === storyId
          ? {
              ...c,
              isBookmarked: data.bookmarked,
              bookmarkCount: c.bookmarkCount + (data.bookmarked ? 1 : -1),
            }
          : c
      )
    );
  }

  async function handleGenerate() {
    if (selected.size === 0) return;
    setGenerating(true);
    setIdeas([]);
    try {
      const res = await fetch("/api/cases/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, storyIds: Array.from(selected) }),
      });
      const data = await res.json();
      setIdeas(data.ideas || []);
    } finally {
      setGenerating(false);
    }
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">案例库</h1>
        <p className="text-sm text-muted-foreground">
          浏览真实职场案例，勾选感兴趣的案例，结合你的知识图谱生成研究问题
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[200px]">
          <Input
            placeholder="搜索案例..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Button type="submit" variant="outline" size="icon">
            <Search className="w-4 h-4" />
          </Button>
        </form>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-36">
            <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="全部分类" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={contextType} onValueChange={setContextType}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="全部场景" />
          </SelectTrigger>
          <SelectContent>
            {CONTEXT_TYPES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-teal/5 border border-teal/20">
          <span className="text-sm">
            已选择 <strong>{selected.size}</strong> 个案例
          </span>
          <Button
            size="sm"
            className="bg-teal text-teal-foreground hover:bg-teal/90"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Lightbulb className="w-4 h-4 mr-1" />
            )}
            生成研究问题
          </Button>
          <button
            className="text-xs text-muted-foreground hover:text-foreground ml-auto"
            onClick={() => setSelected(new Set())}
          >
            清空选择
          </button>
        </div>
      )}

      {/* Cases list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : cases.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            暂无案例。投稿者提交的故事经 AI 处理后会出现在这里。
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => {
            const isExpanded = expandedId === c.id;
            const isSelected = selected.has(c.id);
            return (
              <Card
                key={c.id}
                className={`transition-colors ${isSelected ? "border-teal/40 bg-teal/5" : ""}`}
              >
                <CardContent className="py-4 space-y-2">
                  {/* Header row */}
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(c.id)}
                      className="mt-1 accent-teal"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed">
                        {c.academicSummary || c.anonymizedContent?.slice(0, 200)}
                      </p>
                      {/* Tags */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {c.obCategory && (
                          <span className="text-xs bg-teal/10 text-teal px-2 py-0.5 rounded-full">
                            {CATEGORIES.find((cat) => cat.value === c.obCategory)?.label || c.obCategory}
                          </span>
                        )}
                        {c.keyPhenomena?.slice(0, 3).map((p, i) => (
                          <span key={i} className="text-xs bg-secondary px-2 py-0.5 rounded-full">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleBookmark(c.id)}
                        className="p-1.5 rounded hover:bg-secondary"
                      >
                        {c.isBookmarked ? (
                          <BookmarkCheck className="w-4 h-4 text-teal" />
                        ) : (
                          <Bookmark className="w-4 h-4 text-muted-foreground" />
                        )}
                      </button>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : c.id)}
                        className="p-1.5 rounded hover:bg-secondary"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="ml-7 pt-3 border-t space-y-3">
                      {c.anonymizedContent && (
                        <div>
                          <h4 className="text-xs font-medium text-muted-foreground mb-1">匿名化故事</h4>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">
                            {c.anonymizedContent}
                          </p>
                        </div>
                      )}
                      {c.theoryTags && c.theoryTags.length > 0 && (
                        <div>
                          <h4 className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                            <Tag className="w-3 h-3" /> 理论视角
                          </h4>
                          <div className="space-y-1.5">
                            {c.theoryTags.map((t, i) => (
                              <div key={i} className="text-sm">
                                <span className="font-medium">{t.theory}</span>
                                <span className="text-muted-foreground"> — {t.explanation}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => fetchCases(page - 1)}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground self-center">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => fetchCases(page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Generated Research Ideas */}
      {ideas.length > 0 && (
        <div className="space-y-4 pt-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-teal" />
            生成的研究问题
          </h2>
          {ideas.map((idea, i) => (
            <Card key={i}>
              <CardHeader>
                <CardTitle className="text-base">{idea.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <span className="font-medium">研究问题：</span>
                  <span>{idea.researchQuestion}</span>
                </div>
                {idea.hypotheses?.length > 0 && (
                  <div>
                    <span className="font-medium">假设：</span>
                    <ul className="list-disc ml-5 mt-1 space-y-0.5">
                      {idea.hypotheses.map((h, j) => (
                        <li key={j}>{h}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <span className="font-medium">理论基础：</span>
                  <span className="text-muted-foreground">{idea.theoreticalBasis}</span>
                </div>
                <div>
                  <span className="font-medium">建议方法：</span>
                  <span className="text-muted-foreground">{idea.methodology}</span>
                </div>
                <div>
                  <span className="font-medium">案例关联：</span>
                  <span className="text-muted-foreground">{idea.caseLink}</span>
                </div>
                <div>
                  <span className="font-medium">创新价值：</span>
                  <span className="text-muted-foreground">{idea.novelty}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add "案例库" to the sidebar navigation**

In `src/components/collapsible-sidebar.tsx`, find the navigation items array and add a new entry. Locate the array that contains objects like `{ label: "文献检索", icon: ..., href: ... }` and add after the last research-related item (before 参考文献):

```typescript
{ label: "案例库", icon: BookOpen, href: `/projects/${projectId}/cases` },
```

Also add the `BookOpen` import from `lucide-react` (or use an appropriate existing icon like `MessageSquareText`).

The exact edit depends on the icon imports and array structure — find the `navItems` array and insert the case library entry between "概念模型" and "Proposal" (or at the end of the research section).

- [ ] **Step 3: Commit**

```bash
git add src/app/projects/[id]/cases/page.tsx src/components/collapsible-sidebar.tsx
git commit -m "feat: add researcher case library page with browsing, filtering, and idea generation"
```

---

## Task 9: Integration Testing & Verification

**Files:** None (testing only)

- [ ] **Step 1: Verify schema migration**

```bash
npx prisma db push
npx prisma generate
```

Expected: No errors, new models visible in generated client.

- [ ] **Step 2: Test contributor registration**

```bash
node -e "
const http = require('http');
const data = JSON.stringify({action:'register',email:'test-ob@example.com',password:'Test123456',nickname:'张三'});
const req = http.request({hostname:'127.0.0.1',port:3000,path:'/api/contributors/auth',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}}, res => {
  let body=''; res.on('data',c=>body+=c); res.on('end',()=>console.log(res.statusCode,body));
});
req.write(data); req.end();
"
```

Expected: `200 {"id":"c...","nickname":"张三"}`

- [ ] **Step 3: Test story submission**

Using the `contributor_id` cookie from registration:

```bash
node -e "
const http = require('http');
const data = JSON.stringify({content:'上周在部门会议上，经理提出了一个新的项目方案。几个资深员工立刻表示赞同，但我注意到几个新人虽然表情犹豫却没有发言。会后，我和一个新人聊天时发现，他其实对方案有很好的改进建议，但觉得自己资历太浅不敢提出。这让我想到，组织中的"沉默"到底是因为赞同还是因为心理安全感不足？'});
const req = http.request({hostname:'127.0.0.1',port:3000,path:'/api/stories',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),'Cookie':'contributor_id=<ID_FROM_STEP_2>'}}, res => {
  let body=''; res.on('data',c=>body+=c); res.on('end',()=>console.log(res.statusCode,body));
});
req.write(data); req.end();
"
```

Expected: `200 {"id":"...","status":"PENDING"}` and the story should be processed within 30s.

- [ ] **Step 4: Test case listing (researcher side)**

```bash
node -e "
const http = require('http');
const req = http.request({hostname:'127.0.0.1',port:3000,path:'/api/cases?projectId=<YOUR_PROJECT_ID>',method:'GET',headers:{'Cookie':'user_id=<YOUR_USER_ID>'}}, res => {
  let body=''; res.on('data',c=>body+=c); res.on('end',()=>console.log(res.statusCode,body));
});
req.end();
"
```

Expected: `200 {"cases":[...],"total":...}`

- [ ] **Step 5: Test research question generation**

```bash
node -e "
const http = require('http');
const data = JSON.stringify({projectId:'<PROJECT_ID>',storyIds:['<STORY_ID>']});
const req = http.request({hostname:'127.0.0.1',port:3000,path:'/api/cases/generate',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),'Cookie':'user_id=<USER_ID>'}}, res => {
  let body=''; res.on('data',c=>body+=c); res.on('end',()=>console.log(res.statusCode,body));
});
req.write(data); req.end();
"
```

Expected: `200 {"ideas":[...]}` with 3-5 generated research questions.

- [ ] **Step 6: Visual testing — visit contributor portal**

Open browser at `http://localhost:3000/contribute`:
- Verify landing page renders with intro text
- Register a test account
- Submit a story
- Verify AI processing completes and shows theory tags

- [ ] **Step 7: Visual testing — visit researcher case library**

Open browser at `http://localhost:3000/projects/<id>/cases`:
- Verify sidebar shows "案例库" nav item
- Verify cases load with filters
- Bookmark a case
- Select cases and generate research questions

- [ ] **Step 8: Commit all fixes from testing**

```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```

---

## Task 10: Deploy

- [ ] **Step 1: Push to GitHub**

```bash
git push
```

- [ ] **Step 2: Remind user to SSH deploy**

Remind user:
```
请 SSH 登录服务器后执行：
ssh root@103.38.80.155
cd /opt/scholarflow && git pull && docker compose down && docker compose up -d --build
```

---

## Summary of Data Flow

```
┌─────────────────────┐
│  Contributor Portal  │
│  /contribute/*       │
│                      │
│  1. Register/Login   │
│  2. Submit Story     │──── rawContent ────┐
│  3. AI Follow-up     │                    │
│  4. View Results     │                    ▼
└─────────────────────┘         ┌──────────────────────┐
                                │  AI Pipeline          │
                                │  story-processor.ts   │
                                │                       │
                                │  1. Anonymize          │
                                │  2. Academic Summary   │
                                │  3. Theory Tags        │
                                │  4. Categorize          │
                                └──────────┬─────────────┘
                                           │
                                    status=PUBLISHED
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────┐
│  Researcher Case Library                                 │
│  /projects/[id]/cases                                    │
│                                                          │
│  1. Browse & Filter cases (category, context, search)    │
│  2. Bookmark cases to project                            │
│  3. Select cases → Generate research questions           │
│     (combines cases + knowledge graph)                   │
│  4. → Feed into existing Idea/Review pipeline            │
└─────────────────────────────────────────────────────────┘
```
