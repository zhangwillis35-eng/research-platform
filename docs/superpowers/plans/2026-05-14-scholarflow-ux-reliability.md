# ScholarFlow UX & Reliability Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the most user-impacting reliability and UX issues across ScholarFlow — duplicate papers, silent failures, missing feedback, and brittle error handling.

**Architecture:** Targeted fixes across API routes, React pages, and data pipelines. No schema changes. All changes are backward-compatible. Focus on making existing features work reliably rather than adding new ones.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Prisma 7, DeepSeek V4 Flash

---

## File Map

| File | Responsibility | Tasks |
|------|---------------|-------|
| `src/app/api/papers/route.ts` | Paper CRUD — add dedup on insert | Task 1 |
| `src/app/api/papers/batch-analyze/route.ts` | Batch AI analysis — improve error visibility | Task 2 |
| `src/app/projects/[id]/papers/page.tsx` | Library page — show failures clearly, dedup on import | Task 1, 2 |
| `src/app/projects/[id]/papers/search/page.tsx` | Search page — handle unscored papers in UI | Task 3 |
| `src/lib/research/smart-search.ts` | Search pipeline — log failed scoring count | Task 3 |
| `src/app/api/research/smart-search/route.ts` | Search API — pass failure info to frontend | Task 3 |
| `src/components/error-boundary.tsx` | New: reusable error boundary component | Task 4 |
| `src/app/projects/[id]/review/generate/page.tsx` | Review generation — wrap in error boundary | Task 4 |
| `src/app/projects/[id]/graph/page.tsx` | Knowledge graph — wrap in error boundary | Task 4 |

---

### Task 1: Prevent Duplicate Papers on Insert

Papers get duplicated when users import the same Zotero collection twice or search the same topic multiple times. The `/api/papers` POST route doesn't check for existing papers by DOI or title.

**Files:**
- Modify: `src/app/api/papers/route.ts` (POST handler)

- [ ] **Step 1: Read the current POST handler**

Read `src/app/api/papers/route.ts` to understand the current insert logic. The handler accepts an array of papers and inserts them via Prisma.

- [ ] **Step 2: Add dedup check before insert**

In the POST handler, before `prisma.paper.createMany()`, query for existing papers in the same project by DOI or normalized title. Skip papers that already exist.

```typescript
// Before insert: find existing papers by DOI or normalized title
const existingPapers = await prisma.paper.findMany({
  where: { projectId },
  select: { doi: true, title: true },
});

const existingDois = new Set(
  existingPapers.filter(p => p.doi).map(p => p.doi!.toLowerCase())
);
const existingTitles = new Set(
  existingPapers.map(p => p.title.toLowerCase().replace(/[^a-z0-9]/g, ""))
);

const newPapers = papers.filter(p => {
  if (p.doi && existingDois.has(p.doi.toLowerCase())) return false;
  const normTitle = p.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (existingTitles.has(normTitle)) return false;
  return true;
});

const skipped = papers.length - newPapers.length;
```

- [ ] **Step 3: Return skipped count in response**

```typescript
return NextResponse.json({
  added: newPapers.length,
  skipped,
  message: skipped > 0 ? `${skipped} 篇已存在，已跳过` : undefined,
});
```

- [ ] **Step 4: Test with curl**

```bash
node -e "
const http = require('http');
// Insert a paper, then try to insert the same paper again
// Second insert should return skipped: 1
"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/papers/route.ts
git commit -m "fix: deduplicate papers on insert — skip existing DOI/title"
```

---

### Task 2: Make Batch Analysis Failures Visible

When batch AI analysis fails (rate limits, timeouts), the failure count is only shown at the very end of the stream. Users don't know which papers failed or why. The banner should show live failure count.

**Files:**
- Modify: `src/app/projects/[id]/papers/page.tsx` (batch analysis handler)

- [ ] **Step 1: Read the batch analysis frontend handler**

Read `src/app/projects/[id]/papers/page.tsx` around lines 287-377 to understand how SSE events are processed and displayed.

- [ ] **Step 2: Track failures in real-time state**

Add a `failedCount` state alongside existing progress tracking. Update it as each `status: "error"` event arrives, not just at the end.

```typescript
// In the SSE event handler, when type === "progress" && status === "error":
setFailedCount(prev => prev + 1);
```

- [ ] **Step 3: Show failure count in the progress banner**

Display failures in the progress banner with distinct styling:

```tsx
{analyzedCount > 0 && (
  <span>
    已收录 {total} 篇文献，{analyzedCount} 篇完成 AI 分析
    {withFullText > 0 && `（${withFullText} 篇基于全文）`}
    {failedCount > 0 && (
      <span className="text-red-500">（{failedCount} 篇失败）</span>
    )}
  </span>
)}
```

- [ ] **Step 4: Verify the banner shows live failure count during analysis**

Trigger batch analysis on a small set of papers and observe the banner updating in real-time.

- [ ] **Step 5: Commit**

```bash
git add src/app/projects/[id]/papers/page.tsx
git commit -m "fix: show batch analysis failures in real-time, not just at end"
```

---

### Task 3: Distinguish Unscored Papers from Score-5 Papers in Search UI

After the earlier fix (failed scoring → undefined instead of 5), unscored papers show no score badge. But the search results don't explain WHY there's no score. Users may think it's a bug.

**Files:**
- Modify: `src/app/projects/[id]/papers/search/page.tsx` (score badge rendering)
- Modify: `src/lib/research/smart-search.ts` (report scoring failures)

- [ ] **Step 1: Read the score badge rendering code**

Read `src/app/projects/[id]/papers/search/page.tsx` around lines 2475-2490 where the score badge is rendered.

- [ ] **Step 2: Add "未评分" indicator for unscored papers**

When `paper.relevanceScore == null` AND the search was scored (indicated by `searchStats.relevanceScored`), show a gray "?" badge instead of nothing:

```tsx
{paper.relevanceScore != null ? (
  <div className={`shrink-0 w-10 h-10 rounded-lg border flex flex-col items-center justify-center ${getRelevanceColor(paper.relevanceScore)}`}
    title={paper.relevanceReason || getRelevanceLabel(paper.relevanceScore)}>
    <span className="text-sm font-bold leading-none">{paper.relevanceScore}</span>
    <span className="text-[8px] leading-none mt-0.5">{getRelevanceLabel(paper.relevanceScore).slice(0, 2)}</span>
  </div>
) : searchStats?.relevanceScored ? (
  <div className="shrink-0 w-10 h-10 rounded-lg border border-gray-300 bg-gray-50 flex flex-col items-center justify-center"
    title="评分失败，请重新检索">
    <span className="text-sm font-bold leading-none text-gray-400">?</span>
    <span className="text-[8px] leading-none mt-0.5 text-gray-400">未评</span>
  </div>
) : null}
```

- [ ] **Step 3: Report scoring failure count in search progress**

In `src/lib/research/smart-search.ts`, after scoring is complete, count papers with `undefined` scores and report in the progress callback:

```typescript
const unscoredCount = scoredPapers.filter(p => p.relevanceScore == null).length;
if (unscoredCount > 0) {
  onProgress?.("score", `AI 摘要快速评分: ${papers.length}/${papers.length} 篇...（${unscoredCount} 篇评分失败）`);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/projects/[id]/papers/search/page.tsx src/lib/research/smart-search.ts
git commit -m "fix: show '未评' badge for unscored papers instead of hiding score"
```

---

### Task 4: Add Error Boundary for Complex Pages

The review generation page, knowledge graph page, and proposal page can crash from malformed JSON in streamed responses or corrupted sessionStorage data. A single crash leaves the user with a blank white page.

**Files:**
- Create: `src/components/error-boundary.tsx`
- Modify: `src/app/projects/[id]/review/generate/page.tsx`
- Modify: `src/app/projects/[id]/graph/page.tsx`

- [ ] **Step 1: Create a reusable ErrorBoundary component**

```tsx
"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 p-8">
          <div className="text-red-500 text-lg font-medium">页面渲染出错</div>
          <p className="text-gray-500 text-sm max-w-md text-center">
            {this.state.error?.message?.slice(0, 200) || "未知错误"}
          </p>
          <button
            onClick={this.handleReset}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm"
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Wrap review generation page**

In `src/app/projects/[id]/review/generate/page.tsx`, wrap the main content in `<ErrorBoundary>`:

```tsx
import { ErrorBoundary } from "@/components/error-boundary";

// In the return statement:
<ErrorBoundary onReset={() => { setReviewText(""); setOutline(null); setError(null); }}>
  {/* existing page content */}
</ErrorBoundary>
```

- [ ] **Step 3: Wrap knowledge graph page**

Same pattern for `src/app/projects/[id]/graph/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/error-boundary.tsx src/app/projects/[id]/review/generate/page.tsx src/app/projects/[id]/graph/page.tsx
git commit -m "feat: add ErrorBoundary to complex pages (review, graph)"
```

---

### Task 5: Improve Error Messages in Key API Routes

Several API routes return generic "failed" messages without context. Users can't tell if they should retry, fix their input, or report a bug.

**Files:**
- Modify: `src/app/api/research/smart-search/route.ts`
- Modify: `src/app/api/papers/upload/route.ts`

- [ ] **Step 1: Classify errors in smart-search route**

Read `src/app/api/research/smart-search/route.ts` and add error classification:

```typescript
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  let userMessage: string;
  let status = 500;

  if (err.message.includes("timeout") || err.message.includes("ETIMEDOUT")) {
    userMessage = "检索超时，请缩小检索范围或稍后重试";
    status = 504;
  } else if (err.message.includes("429") || err.message.includes("rate limit")) {
    userMessage = "AI 服务繁忙，请等待 30 秒后重试";
    status = 429;
  } else if (err.message.includes("API key") || err.message.includes("API_KEY")) {
    userMessage = "AI 服务配置错误，请检查设置页面的 API 密钥";
    status = 503;
  } else {
    userMessage = `检索失败: ${err.message.slice(0, 100)}`;
  }

  // Send as final SSE event so frontend can display
  send({ type: "error", error: userMessage });
}
```

- [ ] **Step 2: Improve upload error messages**

In `/api/papers/upload/route.ts`, distinguish between file format errors and processing errors:

```typescript
if (file.size > 50 * 1024 * 1024) {
  return NextResponse.json({ error: "文件大小不能超过 50MB" }, { status: 413 });
}
if (!file.name.endsWith(".pdf")) {
  return NextResponse.json({ error: "仅支持 PDF 格式" }, { status: 400 });
}
// In catch block:
if (err.message.includes("decrypt") || err.message.includes("password")) {
  return NextResponse.json({ error: "PDF 已加密，无法解析。请上传未加密的版本" }, { status: 422 });
}
```

- [ ] **Step 3: Test error responses**

```bash
# Test timeout scenario
node -e "..." # Call smart-search with very narrow query

# Test file upload with non-PDF
curl -X POST http://127.0.0.1:3000/api/papers/upload -F "file=@test.txt"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/research/smart-search/route.ts src/app/api/papers/upload/route.ts
git commit -m "fix: classify errors with user-friendly messages in search + upload"
```

---

## Execution Notes

- Tasks 1-5 are independent and can be parallelized.
- Each task is self-contained — no cross-task dependencies.
- After all tasks, run a full type check: `npx tsc --noEmit`
- Test on production server after deploying.
