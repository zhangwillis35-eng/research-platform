# ScholarFlow — Project Rules

## Architecture

- **Framework**: Next.js 16 (App Router, Turbopack), React 19, TypeScript 5
- **Database**: PostgreSQL (Neon) via Prisma 7, schema at `prisma/schema.prisma`
- **AI Providers**: DeepSeek V4 Flash (default, `deepseek-fast`), Gemini, Claude, GPT-4o — routed via `src/lib/ai/index.ts`
- **Analysis Engine**: Stanford STORM (built-in, `scripts/storm-bridge.py`) + NotebookLM (external MCP)
- **Search Sources**: Google Scholar (Serper), Semantic Scholar, OpenAlex, arXiv, CORE
- **State Persistence**: `usePersistedState` hook → sessionStorage (survives refresh)
- **Background Search**: `searchManager` singleton in `src/lib/search-manager.ts` (survives navigation)

## Core Rules

### Language & Search
- All LLM system prompts MUST be in English. Output responses in Chinese.
- All search queries MUST be in English. Chinese keywords are reserved exclusively for CNKI.
- DeepSeek calls for structured extraction MUST use `noThinking: true` and `jsonMode: true`.

### Data Sources
- Sections 4-8 (文献综述, 知识图谱, 研究想法, 理论整合, 概念模型) MUST use only papers with uploaded PDF full text (`source=fulltext`).
- Section 10 (参考文献) uses all catalog papers regardless of PDF status (`source=catalog`).
- The `fullText` field must be sliced to 5000-8000 chars before sending to LLM.

### Analysis Engine
- STORM is the default analysis engine. The "none" option has been removed.
- Every page with analysis engine support uses a `<select>` dropdown with options: STORM, NotebookLM.
- STORM calls pass a `mode` parameter: `review`, `variables`, `theories`, or `gaps`.

### State & Navigation
- Use `usePersistedState(namespace, key, initialValue)` for state that should survive page navigation and refresh.
- Namespace format: `"pagename-${projectId}"` (e.g., `search-cmo4kau...`).
- The `searchManager` singleton keeps SSE fetch connections alive across page navigation.
- `usePersistedState` initializes with `initialValue` (not from storage) to avoid SSR hydration mismatch. Storage is read in `useEffect`.

### UI Constraints
- NEVER nest `<button>` inside `<button>` — causes hydration errors. Use `<div>` with `onClick` for wrapper elements.
- The `StopButton` component renders a `<Button>` — do not place it inside another button element.
- Strip `fullText` from paper objects before writing to sessionStorage (too large).
- `Set` and `Map` types are auto-serialized by `usePersistedState`.

### API Conventions
- Batch analysis uses SSE streaming (`text/event-stream`).
- All fetch calls in LLM-calling functions must accept an `AbortSignal` for stop button support.
- Paper upload uses `multipart/form-data` with `unpdf` for text extraction.
- After `prisma db push` or schema changes, MUST run `prisma generate` AND delete `.next` cache AND restart dev server.

### Testing & Validation
- After every optimization or code change, you MUST self-test by calling the affected API endpoint or running the affected function to verify it actually works. Do not assume correctness from compilation alone.
- For API changes: test with `node -e "..."` using `http.request` to `127.0.0.1:3000` (bypasses proxy).
- For search pipeline changes: verify `source=fulltext` filter returns correct paper count.
- For LLM prompt changes: test with a real API call and verify the response format.

### Journal Rankings
- FT50: 50 journals. UTD24: 24 journals. ABS 4*: 46 journals (from `journal-data.ts`).
- Normalize function must preserve Chinese characters: `\u4e00-\u9fff` in regex.
- Year validation: reject years > current year (Serper sometimes returns arXiv IDs as years).

### Performance
- DeepSeek relevance scoring: single mode (1 paper/call, best differentiation), 25 concurrent, noThinking.
- Scoring pool: 3x limit (min 60, max 150) papers enter enrichment + scoring; unlimited mode (999) scores all.
- arXiv papers are NEVER dropped: exempt from the scoring-pool cap, from journal-quality filters (year filters still apply), and from the final limit (kept when relevance ≥ 5 or unscored).
- Full-text fetcher: 5s per-strategy timeout, 15s per-paper total timeout.
- Relevance scoring uses abstract only (no full-text fetch) for speed.
- Full-text is only fetched in batch-analyze (deep analysis).

## File Map

```
src/
  app/api/                    # Backend API routes
    papers/                   # CRUD, search, upload, cite, analyze
    research/                 # smart-search, deep-search, review, ideas, theories, proposal
    integrations/             # storm, notebooklm
    graph/                    # Knowledge graph extraction
  app/projects/[id]/          # Frontend pages (11 sections)
  lib/
    ai/                       # LLM clients (deepseek, gemini, claude, openai)
    sources/                  # Search sources (google-scholar, semantic-scholar, openalex, arxiv, core)
    research/                 # Pipelines (smart-search, relevance-scorer, fulltext-fetcher, storm-review)
    integrations/             # STORM bridge, NotebookLM MCP client
    search-manager.ts         # Background search singleton
    concurrent-pool.ts        # Async task concurrency pool
    retry-fetch.ts            # Fetch with exponential backoff
    citation.ts               # APA/MLA/Chicago/BibTeX formatting
  hooks/
    use-persisted-state.ts    # sessionStorage-backed useState
    use-abort.ts              # AbortController hook for stop buttons
  components/
    collapsible-sidebar.tsx   # Navigation bar
    stop-button.tsx           # Reusable stop/cancel button
    ai-provider-select.tsx    # AI model dropdown
scripts/
  storm-bridge.py             # STORM Python bridge (litellm + DeepSeek)
```

@AGENTS.md
