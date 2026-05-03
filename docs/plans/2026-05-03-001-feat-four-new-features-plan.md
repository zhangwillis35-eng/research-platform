---
title: "feat: Add field takeaways, assumptions analysis, NotebookLM batch import, and journal blacklist/whitelist"
type: feat
status: active
date: 2026-05-03
---

# Four New Features for ScholarFlow

## Overview

Add four new capabilities to ScholarFlow:
1. **Field Key Takeaways** — Summarize key takeaways from all papers within a specific field (dual-engine: built-in AI or NotebookLM)
2. **Assumptions Analysis** — Extract and compare assumptions across papers in the literature (dual-engine: built-in AI or NotebookLM)
3. **NotebookLM Batch Import** — Connect to NotebookLM, batch import papers, obtain analysis results
4. **Journal Blacklist/Whitelist** — Filter search results by custom journal include/exclude lists

Features 1 & 2 offer **two analysis paths** the user can choose between:
- **Built-in AI** (ScholarFlow's own LLM providers: DeepSeek/Gemini/Claude/GPT-4o) — reads paper full text directly, works offline, no external dependency
- **NotebookLM** (Google's Gemini-grounded RAG) — papers are first batch-imported to a notebook, then queried for takeaways/assumptions. Leverages NotebookLM's source-grounded citation system.

## Problem Frame

Researchers using ScholarFlow can search, collect, and analyze papers individually, but lack tools to synthesize field-level insights (what does the literature collectively say? what assumptions differ?). NotebookLM integration exists only as CLI scripts — not accessible from the web UI. Journal filtering is powerful but preset-only — users cannot create custom include/exclude lists matching their specific field norms.

Users have different needs: some want a fully self-contained analysis pipeline (built-in AI), while others prefer Google's NotebookLM for its source-grounded answers and interactive exploration. Both paths should be first-class options.

## Requirements Trace

- R1. Users can generate a field-level summary of key takeaways from selected papers (with full text)
- R2. Users can extract and compare assumptions across papers, seeing where assumptions differ
- R3. Users can batch-import papers from their ScholarFlow library to a NotebookLM notebook via the web UI
- R4. Users can query NotebookLM and see results within ScholarFlow
- R5. Users can create/manage journal blacklists and whitelists (via CSV upload or manual editing)
- R6. Journal filters are applied during search, filtering out blacklisted or non-whitelisted journals
- R7. All LLM prompts in English, output in Chinese (per CLAUDE.md)
- R8. Features 1 & 2 use only papers with uploaded PDF full text (`source=fulltext`)
- R9. All analysis pages support triple-engine selection: Built-in AI (default) / STORM / NotebookLM
- R10. NotebookLM path auto-imports papers to notebook before querying if not already imported
- R11. Field takeaways gaps can be sent to the Ideas page as idea seeds
- R12. Extracted assumptions can be sent to the Theories page as theory boundary conditions

## Scope Boundaries

- No changes to existing search pipeline logic (only adding a filter step)
- No NotebookLM Enterprise API — using `notebooklm-py` (browser-based auth)
- No audio overview generation in this iteration (batch import + Q&A only)
- Field takeaways and assumptions are analysis actions on the papers page, not new standalone pages
- All three engines produce the same output structure per feature — same rendering, different backends

### Deferred to Separate Tasks

- Audio overview generation and download from NotebookLM
- Active learning paper screening (ASReview-style)
- Deep cross-feature chaining (e.g., auto-trigger idea generation from gaps)

## Context & Research

### Relevant Code and Patterns

- Papers page (`src/app/projects/[id]/papers/page.tsx`): Has tabs (catalog/weekly), AI analysis, PDF upload. New features add as analysis actions here.
- Search page (`src/app/projects/[id]/papers/search/page.tsx`): Has `SearchFilters` interface with journal quality filters. Journal blacklist/whitelist adds a new filter dimension.
- Search aggregator (`src/lib/sources/aggregator.ts`): Orchestrates multi-source search with dedup and enrichment. Post-filter step for journal filtering goes here.
- Journal data (`src/lib/sources/journal-data.ts`, `journal-rankings.ts`, `journal-metadata.ts`): Existing journal name normalization and ranking databases.
- STORM review pipeline (`src/lib/research/storm-review.ts`): Multi-perspective review generation. Pattern for field takeaways LLM calls.
- Existing NotebookLM scripts (`scripts/upload-to-notebooklm.py`, `scripts/notebooklm-proxy.mjs`): Will be replaced/superseded by `notebooklm-py` integration.
- Batch analyze API (`src/app/api/papers/batch-analyze/route.ts`): SSE streaming pattern for long-running analysis.
- AI router (`src/lib/ai/index.ts`): `callAI()` and `streamAI()` for LLM calls.

### External References

- **notebooklm-py** (12.3k stars): `pip install notebooklm-py`. Python API for NotebookLM with `client.sources.add_url()`, `client.chat.ask()`, batch operations. Auth via `notebooklm login`. GitHub: `teng-lin/notebooklm-py`
- **PyPaperBot** (630 stars): CSV-based journal filter pattern (`journal_name,include_or_exclude`). GitHub: `ferru97/PyPaperBot`
- **PaperQA2** (8k stars): Cross-paper contradiction detection and evidence synthesis. Reference for assumptions comparison logic.
- **Ai2 ScholarQA**: Comparison table generation across papers. Reference for structured cross-paper analysis.

## Key Technical Decisions

- **Triple-engine architecture**: All analysis pages (field takeaways, assumptions, review, ideas, theories, graph) offer three engine options via a unified `<select>`: "Built-in AI" (default) / "STORM" / "NotebookLM". Built-in AI uses ScholarFlow's LLM providers directly. STORM uses the existing Python bridge with new analysis modes. NotebookLM uses `notebooklm-py` with auto-import. All engines produce the same structured output format per feature so the UI rendering is shared.
- **Shared AnalysisEngineSelect component**: A new reusable component replaces the current hardcoded STORM-only engine state across all 6 analysis pages. Shows AI provider dropdown when "Built-in AI" selected, nothing extra for STORM, and notebook status for NotebookLM.
- **NotebookLM path auto-imports**: When user selects NotebookLM engine for analysis, the system first checks if papers are already in the notebook. If not, it auto-imports them before querying. Seamless for the user.
- **Cross-feature integration**: Field takeaways results include "Send gaps to Ideas" button (creates idea seeds from identified gaps). Assumptions results include "Send to Theories" button (maps assumptions to theory boundaries). This connects the new features to the existing research pipeline.
- **notebooklm-py over notebooklm-mcp-cli**: Richer API, 12.3k stars, better maintained. Requires migration from existing scripts but provides proper batch import, research import, and structured queries.
- **CSV + DB for journal lists**: Users upload CSV files (PyPaperBot format: `journal_name,1/0`) or edit in UI. Lists stored in Prisma DB per project. Combines flexibility with persistence.
- **Features 1 & 2 on papers page**: Added as analysis actions (buttons) on the paper library, operating on selected papers with full text. Results displayed inline with collapsible sections.
- **Python subprocess for NotebookLM**: Like STORM bridge, NotebookLM calls go through a Python subprocess (`notebooklm-py`). The Next.js API route spawns Python and communicates via stdout JSON.
- **Post-filter for journal blacklist/whitelist**: Applied after search aggregation and dedup, before relevance scoring. Uses normalized journal name matching (existing `normalizeJournalName`).

## Open Questions

### Resolved During Planning

- **Where do Features 1 & 2 live?** → On the papers page as analysis actions (user chose this)
- **Which NotebookLM library?** → `notebooklm-py` (user chose to switch)
- **How are journal lists managed?** → CSV upload + DB storage with UI editing (user chose this)

### Deferred to Implementation

- Exact NotebookLM session management strategy (how long to keep sessions alive)
- Whether to cache NotebookLM responses in the DB
- Optimal batch size for NotebookLM source uploads (notebooklm-py may have its own limits)

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Feature 1 & 2: Field Analysis — Dual Engine
────────────────────────────────────────────
Papers Page (papers/page.tsx)
  └─ New "Field Analysis" section (collapsible)
      ├─ Engine selector: [Built-in AI ▾] / [NotebookLM ▾]
      │
      ├─ [Generate Field Takeaways] button
      │    ├─ Built-in AI path:
      │    │    → POST /api/papers/field-takeaways { engine: "builtin", provider, paperIds }
      │    │    → LLM reads all selected papers' full text directly
      │    │    → Streams structured summary (key findings, methods, debates, trends, gaps)
      │    └─ NotebookLM path:
      │         → POST /api/papers/field-takeaways { engine: "notebooklm", paperIds }
      │         → Step 1: Auto-import papers to notebook (if not already imported)
      │         → Step 2: Query NotebookLM with field-takeaways prompt
      │         → Returns grounded summary with source citations
      │
      └─ [Analyze Assumptions] button
           ├─ Built-in AI path:
           │    → POST /api/papers/assumptions { engine: "builtin", provider, paperIds }
           │    → Two-phase LLM: extract per-paper → cross-compare
           │    → Returns per-paper assumptions + comparison table
           └─ NotebookLM path:
                → POST /api/papers/assumptions { engine: "notebooklm", paperIds }
                → Step 1: Auto-import papers to notebook
                → Step 2: Query NotebookLM with assumptions-extraction prompt
                → Step 3: Query NotebookLM with cross-comparison prompt
                → Returns grounded comparison with source citations

Feature 3: NotebookLM Standalone Batch Import + Q&A
────────────────────────────────────────────────────
Papers Page → [Send to NotebookLM] button (standalone batch import)
  → POST /api/integrations/notebooklm { action: "batch-import" }
  → Python subprocess: notebooklm-py
  → Uploads paper URLs/PDFs in batches
  → Returns per-paper success/failure

Papers Page → [Ask NotebookLM] free-form Q&A input
  → POST /api/integrations/notebooklm { action: "ask" }
  → Python subprocess: notebooklm-py client.chat.ask()
  → Returns answer with source citations + sessionId

Settings Page → NotebookLM notebook URL input
  → Stored in ResearchProject.notebookUrl (already in schema)

Feature 4: Journal Blacklist/Whitelist
──────────────────────────────────────
New DB model: JournalFilter
  → projectId, journalName, filterType (blacklist/whitelist), source (csv/manual)

Search Page → New "Journal Filter" panel
  → Upload CSV / manually add journals
  → Toggle blacklist vs whitelist mode
  → Preset buttons: FT50, UTD24, ABS 4*
  → POST /api/papers/journal-filter (CRUD)

Search Pipeline:
  aggregator.ts → after dedup, before scoring
  → Load project's journal filters
  → If whitelist mode: keep only whitelisted journals
  → If blacklist mode: remove blacklisted journals
  → Uses normalizeJournalName for fuzzy matching
```

## Implementation Units

### Phase 0: Shared Infrastructure

- [ ] **Unit 0: AnalysisEngineSelect component + STORM mode extensions**

**Goal:** Create a shared engine selector component and extend STORM with new analysis modes

**Requirements:** R9

**Dependencies:** None

**Files:**
- Create: `src/components/analysis-engine-select.tsx`
- Modify: `scripts/storm-bridge.py` (add `field-summary` and `assumptions` modes)

**Approach:**
- **AnalysisEngineSelect component**:
  - `<select>` dropdown with 3 options: "Built-in AI" / "STORM" / "NotebookLM"
  - Props: `value`, `onChange`, `notebookConfigured: boolean`
  - When "Built-in AI" selected: parent shows `AIProviderSelect` alongside
  - When "STORM" selected: nothing extra needed (STORM uses DeepSeek internally)
  - When "NotebookLM" selected: show connection status badge; if not configured, show warning icon + tooltip "Configure in Settings"
  - Styled consistent with existing `AIProviderSelect`
- **STORM mode extensions**:
  - Add `"field-summary"` mode to `storm-bridge.py` PROMPTS dict — prompt for cross-paper field synthesis (key findings, methods, debates, trends, gaps)
  - Add `"assumptions"` mode — prompt for per-paper assumption extraction + cross-comparison
  - These complement existing modes: `review`, `variables`, `theories`, `gaps`

**Patterns to follow:**
- `src/components/ai-provider-select.tsx` — component structure and styling
- Existing STORM mode prompts in `scripts/storm-bridge.py`

**Test scenarios:**
- Happy path: Component renders with 3 options, emits correct value on change
- Happy path: STORM `field-summary` mode produces structured field synthesis
- Happy path: STORM `assumptions` mode produces per-paper + comparison output
- Edge case: NotebookLM not configured → warning indicator shown

**Verification:**
- Component renders correctly in isolation
- `echo '{"topic":"...","papers":[...],"mode":"field-summary","api_key":"..."}' | python3 storm-bridge.py` returns valid output

---

### Phase 1: Database & Backend Foundation

- [ ] **Unit 1: Journal filter schema + API**

**Goal:** Add JournalFilter model to Prisma and CRUD API routes

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/app/api/papers/journal-filter/route.ts`

**Approach:**
- Add `JournalFilter` model: `id, projectId, journalName (normalized), filterType (enum: BLACKLIST/WHITELIST), createdAt`
- Add `JournalFilterMode` on `ResearchProject`: `journalFilterMode String? // "blacklist" | "whitelist" | null`
- API route handles: GET (list filters), POST (create/bulk-create from CSV), DELETE (remove)
- CSV parsing: accept `journal_name,1/0` format (PyPaperBot compatible) or `journal_name` only (all treated as the active filter type)
- Normalize journal names on insert using existing `normalizeJournalName`

**Patterns to follow:**
- Prisma model style from existing schema (cuid IDs, `@@index`, `onDelete: Cascade`)
- API route style from `src/app/api/papers/route.ts`

**Test scenarios:**
- Happy path: POST CSV with 10 journals → 10 JournalFilter records created with normalized names
- Happy path: GET returns all filters for project, grouped by type
- Happy path: DELETE removes specific filter by ID
- Edge case: CSV with duplicate journal names → deduplicated on insert
- Edge case: CSV with Chinese journal names → preserved correctly (unicode regex)
- Error path: Invalid CSV format → 400 with descriptive error message

**Verification:**
- `prisma db push` succeeds, `prisma generate` produces updated client
- API endpoints return correct data via `node -e` test

---

- [ ] **Unit 2: Apply journal filter in search pipeline**

**Goal:** Filter search results by project's journal blacklist/whitelist

**Requirements:** R6

**Dependencies:** Unit 1

**Files:**
- Modify: `src/lib/sources/aggregator.ts`
- Modify: `src/app/api/papers/search/route.ts`

**Approach:**
- After deduplication and before relevance scoring in the aggregator, load the project's journal filters
- If `journalFilterMode === "whitelist"`: keep only papers whose normalized venue matches a whitelist entry
- If `journalFilterMode === "blacklist"`: remove papers whose normalized venue matches a blacklist entry
- Use `normalizeJournalName` for fuzzy matching (already handles abbreviations, case, punctuation)
- Pass `projectId` to the aggregator so it can query filters
- Add filter stats to search response (`filteredByJournalFilter: number`)

**Patterns to follow:**
- Existing filter logic in `aggregator.ts` (SCI/SSCI/JCR filters)
- Journal name normalization from `journal-data.ts`

**Test scenarios:**
- Happy path: Search with blacklist containing "Journal of X" → papers from that journal excluded from results
- Happy path: Search with whitelist of 5 journals → only papers from those journals returned
- Edge case: Paper venue is abbreviated ("J. Finance") but filter has full name ("Journal of Finance") → matched via normalization
- Edge case: No filters configured → no filtering applied, all papers pass through
- Integration: Full search pipeline with filters → `filteredByJournalFilter` count in response matches expected exclusions

**Verification:**
- Search with and without filters returns different result counts
- `filteredByJournalFilter` stat accurately reflects excluded papers

---

- [ ] **Unit 3: Field takeaways API (triple-engine)**

**Goal:** API endpoint that generates field-level key takeaways via Built-in AI, STORM, or NotebookLM

**Requirements:** R1, R7, R8, R9, R10

**Dependencies:** Unit 0 (STORM modes), Unit 5, Unit 6 (for NotebookLM path)

**Files:**
- Create: `src/app/api/papers/field-takeaways/route.ts`
- Create: `src/lib/research/field-analysis.ts`

**Approach:**
- POST endpoint accepts `{ projectId, paperIds?, provider, engine: "builtin" | "storm" | "notebooklm" }`
- Shared logic in `src/lib/research/field-analysis.ts`:
  - `generateFieldTakeaways(papers, engine, provider?)` — dispatches to the correct engine
  - All engines produce the same output structure: `{ keyFindings, methodologicalTrends, debates, emergingTrends, gaps, citations }`
- **Built-in AI path** (default):
  - Fetches papers with `fullText`; slice to 6000 chars each
  - Build LLM prompt (English) asking to synthesize across all papers
  - Use `streamAI()` for SSE streaming
  - System prompt in English, output in Chinese
- **STORM path**:
  - Call STORM bridge with `mode: "field-summary"` and paper data
  - STORM's multi-perspective approach generates synthesis from different expert viewpoints
  - Parse STORM output into the same structure
- **NotebookLM path**:
  - Check notebook URL configured (from ResearchProject.notebookUrl)
  - Auto-import papers to notebook if not already there
  - Query NotebookLM with a structured field-takeaways prompt
  - NotebookLM responses include source-grounded citations automatically
- Accept AbortSignal for stop button support

**Patterns to follow:**
- `src/app/api/research/review/route.ts` — SSE streaming pattern
- `src/lib/research/storm-review.ts` — multi-paper LLM prompt construction
- `src/lib/integrations/storm.ts` — engine dispatch pattern

**Test scenarios:**
- Happy path (builtin): 10 papers → structured field summary in Chinese with paper citations
- Happy path (storm): 10 papers → STORM multi-perspective field synthesis
- Happy path (notebooklm): 10 papers → auto-import + query → grounded summary with source citations
- Edge case: Only 1 paper → generates summary noting limited scope (all engines)
- Edge case: NotebookLM engine but no notebook URL → 400 with "Configure NotebookLM in Settings"
- Error path: No papers with full text → 400 error
- Error path: STORM not available (Python missing) → 500 with setup instructions

**Verification:**
- All three engine paths return structured summaries with citations
- Output structure is identical regardless of engine

---

- [ ] **Unit 4: Assumptions analysis API (triple-engine)**

**Goal:** API endpoint that extracts and compares assumptions via Built-in AI, STORM, or NotebookLM

**Requirements:** R2, R7, R8, R9, R10

**Dependencies:** Unit 0 (STORM modes), Unit 5, Unit 6 (for NotebookLM path)

**Files:**
- Create: `src/app/api/papers/assumptions/route.ts`
- Modify: `src/lib/research/field-analysis.ts` (add assumptions functions)

**Approach:**
- POST endpoint accepts `{ projectId, paperIds?, provider, engine: "builtin" | "storm" | "notebooklm" }`
- Shared logic in `field-analysis.ts`:
  - `analyzeAssumptions(papers, engine, provider?)` — dispatches to correct engine
  - All engines produce: `{ perPaper: [{title, assumptions: {theoretical, methodological, boundary, implicit}}], comparison: {shared, conflicting, unique} }`
- **Built-in AI path**:
  - Two-phase LLM pipeline:
    - Phase 1: Extract assumptions per paper
    - Phase 2: Cross-compare — shared, conflicting, unstated, unique-to-paper
  - SSE streaming for progress
- **STORM path**:
  - Call STORM bridge with `mode: "assumptions"` and paper data
  - STORM generates multi-perspective assumption analysis
  - Parse into same output structure
- **NotebookLM path**:
  - Auto-import papers to notebook (if needed)
  - Query 1: Extract assumptions per source
  - Query 2: Cross-compare assumptions across sources
  - Parse NotebookLM responses into same structure
- Inspired by PaperQA2's contradiction detection approach

**Patterns to follow:**
- `src/app/api/research/theories/route.ts` — extraction + synthesis pattern
- `src/lib/research/idea-pipeline.ts` — multi-phase LLM pipeline

**Test scenarios:**
- Happy path (builtin): 8 papers → per-paper assumptions + cross-comparison table
- Happy path (storm): 8 papers → STORM multi-perspective assumption analysis
- Happy path (notebooklm): 8 papers → auto-import + two queries → grounded comparison
- Happy path: Papers with conflicting methodological assumptions → clearly highlighted (all engines)
- Edge case: All papers share same assumptions → summary notes high consensus
- Error path: No papers with full text → 400 error

**Verification:**
- All three engine paths produce per-paper assumptions and cross-comparison
- Conflicting assumptions explicitly identified with paper citations

---

- [ ] **Unit 5: NotebookLM Python bridge**

**Goal:** Python bridge script using `notebooklm-py` for batch import and Q&A

**Requirements:** R3, R4

**Dependencies:** None

**Files:**
- Create: `scripts/notebooklm-bridge.py`

**Approach:**
- Install `notebooklm-py` via pip/uv
- Bridge script accepts JSON commands via stdin, outputs JSON via stdout (same pattern as `scripts/storm-bridge.py`)
- Commands:
  - `check`: Verify auth status and library access
  - `batch-import`: Accept list of `{url, title}` objects, upload to notebook via `client.sources.add_url()`
  - `ask`: Send question to notebook, return answer with citations
  - `list-notebooks`: List available notebooks
- Auth: Relies on `notebooklm login` being run once (persists credentials)
- Batch import: Process in batches of 5, report progress per batch
- Error handling: Return structured JSON errors for auth failures, rate limits, network issues

**Patterns to follow:**
- `scripts/storm-bridge.py` — Python subprocess bridge pattern (JSON stdin/stdout)

**Test scenarios:**
- Happy path: `check` command returns auth status and notebook count
- Happy path: `batch-import` with 12 URLs → 3 batches of 5/5/2, all succeed
- Happy path: `ask` returns answer with source citations
- Error path: Not authenticated → structured error with instructions to run `notebooklm login`
- Error path: Invalid notebook ID → clear error message

**Verification:**
- Script runs standalone: `echo '{"command":"check"}' | python scripts/notebooklm-bridge.py`
- Batch import adds sources to a real NotebookLM notebook

---

- [ ] **Unit 6: NotebookLM API routes**

**Goal:** Next.js API routes wrapping the Python bridge

**Requirements:** R3, R4

**Dependencies:** Unit 5

**Files:**
- Create: `src/app/api/integrations/notebooklm/route.ts`
- Create: `src/lib/integrations/notebooklm.ts`

**Approach:**
- `src/lib/integrations/notebooklm.ts`: TypeScript wrapper for spawning `notebooklm-bridge.py` subprocess
  - `checkNotebookLM()`: Verify availability and auth
  - `batchImportToNotebookLM(notebookUrl, papers)`: Upload papers (URLs or DOI links)
  - `askNotebookLM(notebookUrl, question, sessionId?)`: Q&A with session continuity
- API route handles POST with action parameter:
  - `action: "check"` → verify auth
  - `action: "batch-import"` → batch upload papers from project library
  - `action: "ask"` → Q&A query
- For batch-import: fetch papers from DB, extract URLs (openAccessPdf → pdfUrl → doi URL fallback), pass to bridge
- SSE streaming for batch-import progress (per-paper status updates)

**Patterns to follow:**
- `src/lib/integrations/storm.ts` — Python subprocess integration pattern
- `src/app/api/integrations/storm/route.ts` — API route wrapping Python bridge

**Test scenarios:**
- Happy path: POST `action: "check"` → returns `{ available: true, authenticated: true }`
- Happy path: POST `action: "batch-import"` with projectId → streams per-paper upload status
- Happy path: POST `action: "ask"` with question → returns answer + sessionId
- Error path: notebooklm-py not installed → `{ available: false, error: "notebooklm-py not installed" }`
- Error path: Not authenticated → clear error with setup instructions

**Verification:**
- API endpoints respond correctly via `node -e` HTTP tests to `127.0.0.1:3000`

---

### Phase 2: Frontend UI

- [ ] **Unit 7: Journal filter UI on search page**

**Goal:** Add journal blacklist/whitelist management panel to the search page

**Requirements:** R5, R6

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `src/app/projects/[id]/papers/search/page.tsx`

**Approach:**
- Add a new collapsible "Journal Filter" section in the search filters area
- Two modes: Blacklist / Whitelist (toggle switch)
- CSV upload button: `<input type="file" accept=".csv">`, parse and POST to `/api/papers/journal-filter`
- Manual add: text input + add button for individual journal names
- Display current filter list with remove (X) buttons per journal
- Show filter count badge
- Preset buttons: "Load FT50", "Load UTD24", "Load ABS 4*" — bulk-add from existing `journal-data.ts`
- Filters auto-apply on next search (passed via `projectId` in search request)

**Patterns to follow:**
- Existing filter UI in search page (SCI/SSCI toggles, JCR dropdown)
- Card/Badge components from shadcn/ui

**Test scenarios:**
- Happy path: Upload CSV with 20 journals → list appears in UI, next search excludes those journals (blacklist mode)
- Happy path: Click "Load FT50" → 50 journals added to whitelist
- Happy path: Remove individual journal → list updates, next search reflects change
- Edge case: Switch from blacklist to whitelist mode → UI updates, search behavior inverts

**Verification:**
- Filter panel renders correctly with all controls
- Search results change when filters are active vs inactive

---

- [ ] **Unit 8: Field takeaways & assumptions UI on papers page (triple-engine + cross-feature)**

**Goal:** Add field analysis with engine selector and cross-feature integration to the paper library page

**Requirements:** R1, R2, R9, R11, R12

**Dependencies:** Unit 0, Unit 3, Unit 4

**Files:**
- Modify: `src/app/projects/[id]/papers/page.tsx`

**Approach:**
- Add new collapsible "Field Analysis" section below the paper list header
- **Engine selector**: Use `AnalysisEngineSelect` component (Unit 0) — "Built-in AI" / "STORM" / "NotebookLM"
  - When "Built-in AI" selected: show `AIProviderSelect` dropdown
  - When "STORM" selected: nothing extra
  - When "NotebookLM" selected: show notebook connection status badge
- Two action buttons:
  - "Generate Field Takeaways" → calls `/api/papers/field-takeaways` with `{ engine, provider, paperIds }`
  - "Analyze Assumptions" → calls `/api/papers/assumptions` with `{ engine, provider, paperIds }`
- Both use SSE streaming with progress indicator
- Results rendered in collapsible cards (same rendering regardless of engine):
  - Field takeaways: structured sections (key findings, methods, debates, trends, gaps)
  - Assumptions: per-paper assumption cards + cross-comparison table
- **Cross-feature integration buttons on results:**
  - Field takeaways → "Send gaps to Research Ideas" button: navigates to ideas page with gaps as pre-filled seed context (via sessionStorage)
  - Field takeaways → "Send to Literature Review" button: navigates to review page with takeaways as pre-filled context
  - Assumptions → "Send to Theory Integration" button: navigates to theories page with assumptions as pre-filled boundary conditions
  - Assumptions → "Send to Knowledge Graph" button: navigates to graph page with assumption-derived variable relationships
- Stop button support via `useAbort`
- Persisted results + engine selection via `usePersistedState`
- Only enabled when papers with full text are selected

**Patterns to follow:**
- Paper overview section in same page (collapsible, streaming)
- `AnalysisEngineSelect` from Unit 0
- Cross-page data passing: write to sessionStorage with namespaced keys, receiving page reads on mount

**Test scenarios:**
- Happy path (builtin): Select 5 papers → "Built-in AI" + DeepSeek → streaming summary
- Happy path (storm): Select 5 papers → "STORM" → multi-perspective synthesis
- Happy path (notebooklm): Select 5 papers → "NotebookLM" → auto-import + query
- Happy path: Click "Send gaps to Research Ideas" → navigates to ideas page with gaps pre-filled
- Happy path: Click "Send to Theory Integration" → navigates to theories page with assumptions pre-filled
- Edge case: NotebookLM selected but no notebook URL → warning, button disabled
- Edge case: No papers with full text → buttons disabled with tooltip

**Verification:**
- All three engines produce results in same UI structure
- Cross-feature buttons navigate correctly and pre-fill target pages

---

- [ ] **Unit 9: NotebookLM UI on papers page + settings**

**Goal:** Add NotebookLM batch import and Q&A interface

**Requirements:** R3, R4

**Dependencies:** Unit 6

**Files:**
- Modify: `src/app/projects/[id]/papers/page.tsx`
- Modify: `src/app/projects/[id]/settings/page.tsx`

**Approach:**
- **Settings page**: Add NotebookLM configuration section
  - Notebook URL input field → saved to `ResearchProject.notebookUrl`
  - "Test Connection" button → calls `/api/integrations/notebooklm` with `action: "check"`
  - Auth status indicator
  - Link to `notebooklm login` instructions if not authenticated
- **Papers page**: Add NotebookLM section (collapsible)
  - "Send to NotebookLM" button: batch-imports selected papers
  - Shows SSE progress (per-paper upload status: pending/uploading/success/failed)
  - "Ask NotebookLM" input: text input + send button for Q&A
  - Q&A response area with session continuity (pass sessionId between calls)
  - Only visible when `notebookUrl` is configured (check on page load)

**Patterns to follow:**
- Zotero/Obsidian settings UI on settings page
- Batch analyze streaming UI on papers page

**Test scenarios:**
- Happy path: Configure notebook URL in settings → "Test Connection" succeeds → NotebookLM section appears on papers page
- Happy path: Select 10 papers → "Send to NotebookLM" → progress shows 10/10 uploaded
- Happy path: Ask question → answer with citations displayed
- Happy path: Follow-up question uses same session → context-aware answer
- Error path: No notebook URL configured → NotebookLM section shows "Configure in Settings" link
- Error path: Auth expired → clear error with re-auth instructions

**Verification:**
- Settings page saves and tests NotebookLM connection
- Papers page shows batch import progress and Q&A responses

---

### Phase 3: Integration & Polish

- [ ] **Unit 10: Wire triple-engine selector into existing analysis pages**

**Goal:** Replace hardcoded STORM-only engine state with the AnalysisEngineSelect component across all existing analysis pages

**Requirements:** R9

**Dependencies:** Unit 0, Unit 6

**Files:**
- Modify: `src/app/projects/[id]/review/generate/page.tsx`
- Modify: `src/app/projects/[id]/ideas/generate/page.tsx`
- Modify: `src/app/projects/[id]/theories/integrate/page.tsx`
- Modify: `src/app/projects/[id]/graph/page.tsx`
- Modify: `src/app/projects/[id]/proposal/page.tsx`
- Modify: `src/app/projects/[id]/model/page.tsx`
- Modify: `src/app/api/research/review/route.ts`
- Modify: `src/app/api/research/ideas/route.ts`
- Modify: `src/app/api/research/theories/route.ts`

**Approach:**
- Each page currently has `const [analysisEngine] = usePersistedState<"storm">(NS, "engine", "storm")` — replace with `usePersistedState<"builtin" | "storm" | "notebooklm">(NS, "engine", "builtin")`
- Add `AnalysisEngineSelect` component alongside existing `AIProviderSelect`
- Pass `engine` parameter in API calls alongside `provider`
- API routes dispatch to the correct backend:
  - `"builtin"`: Use existing `streamAI()`/`callAI()` with the selected provider
  - `"storm"`: Use existing STORM bridge (current behavior)
  - `"notebooklm"`: Use new NotebookLM bridge — auto-import papers, then query
- For NotebookLM path on each page:
  - Review: Query "Generate a comprehensive literature review on {topic} using these sources"
  - Ideas: Query "What novel research ideas emerge from gaps in these sources?"
  - Theories: Query "What theories are used, how do they connect, what's the integration potential?"
  - Graph: Query "Extract variable relationships (IV, DV, mediators, moderators) from these sources"
- Each page checks `notebookUrl` availability when NotebookLM is selected

**Patterns to follow:**
- Current page structure (just swap the engine state and add the selector)
- Unit 8's engine dispatch pattern

**Test scenarios:**
- Happy path: Review page → select "Built-in AI" → works as before with direct LLM call
- Happy path: Review page → select "STORM" → works as before (current default behavior)
- Happy path: Review page → select "NotebookLM" → auto-imports papers, queries, streams response
- Happy path: Engine selection persists across page navigation (per-page independent)
- Edge case: Switch between engines mid-workflow → previous results preserved, new engine used for next generation
- Integration: Ideas page with NotebookLM → generates ideas grounded in NotebookLM sources

**Verification:**
- All 6 pages show the triple-engine selector
- Each engine produces results on each page
- STORM behavior unchanged when selected (backward compatible)

---

- [ ] **Unit 11: Cross-feature data flow infrastructure**

**Goal:** Enable seamless data passing between features (gaps → ideas, assumptions → theories)

**Requirements:** R11, R12

**Dependencies:** Unit 8, Unit 10

**Files:**
- Create: `src/lib/cross-feature.ts`
- Modify: `src/app/projects/[id]/ideas/generate/page.tsx` (receive gap seeds)
- Modify: `src/app/projects/[id]/theories/integrate/page.tsx` (receive assumption data)
- Modify: `src/app/projects/[id]/review/generate/page.tsx` (receive field takeaways as context)
- Modify: `src/app/projects/[id]/graph/page.tsx` (receive assumption-derived relationships)

**Approach:**
- `src/lib/cross-feature.ts`: Utility for cross-page data transfer
  - `setCrossFeatureData(targetPage, data)` — writes to sessionStorage with key `crossfeature-{targetPage}-{projectId}`
  - `getCrossFeatureData(targetPage)` — reads and clears (one-time consumption)
  - Data types: `GapSeeds` (for ideas), `AssumptionBoundaries` (for theories), `FieldContext` (for review), `VariableHints` (for graph)
- **Ideas page**: On mount, check for `GapSeeds` data. If present, show banner "Pre-filled with gaps from Field Analysis" and populate the dimension extraction step with gap context
- **Theories page**: On mount, check for `AssumptionBoundaries`. If present, pre-populate the theory extraction with boundary conditions and assumption categories
- **Review page**: On mount, check for `FieldContext`. If present, use field takeaways as outline seed (skip outline generation or pre-fill it)
- **Graph page**: On mount, check for `VariableHints`. If present, suggest variable nodes and relationships from assumption analysis
- Each receiving page shows a dismissible banner indicating pre-filled data source

**Patterns to follow:**
- `usePersistedState` pattern for sessionStorage access
- Existing page mount patterns (useEffect on projectId)

**Test scenarios:**
- Happy path: Generate field takeaways → click "Send gaps to Ideas" → navigate → ideas page shows banner with pre-filled gaps
- Happy path: Analyze assumptions → click "Send to Theories" → navigate → theories page shows pre-filled boundaries
- Happy path: Dismiss pre-filled banner → page works normally without pre-filled data
- Edge case: Navigate to ideas page without cross-feature data → no banner, normal behavior
- Edge case: Pre-filled data from a different project → ignored (projectId mismatch)

**Verification:**
- Data flows correctly between pages via sessionStorage
- Receiving pages detect and use pre-filled data
- Normal page behavior unchanged when no cross-feature data present

---

- [ ] **Unit 12: Update project overview page**

**Goal:** Update the project overview page to list new integrations and capabilities

**Requirements:** Per AGENTS.md — must update overview when adding external tools

**Dependencies:** Units 7-11

**Files:**
- Modify: `src/app/projects/[id]/page.tsx`

**Approach:**
- Add notebooklm-py to the external tools integration list with description
- Add journal filter feature mention
- Add field analysis (takeaways + assumptions) with triple-engine support
- Add cross-feature workflow description (gaps → ideas, assumptions → theories)
- Update service status section to show NotebookLM connection status

**Test expectation:** none — pure content update, no behavioral change

**Verification:**
- Overview page displays updated integration list and workflow connections

## System-Wide Impact

- **Interaction graph:** The triple-engine selector touches all 6 analysis pages + 3 API routes. Cross-feature data flow connects papers page → ideas/theories/review/graph pages via sessionStorage. Journal filter affects the search pipeline (aggregator.ts).
- **Error propagation:** NotebookLM Python subprocess errors must bubble up as structured JSON to the API route, then as user-friendly messages to the UI. Auth failures need specific handling (not generic 500s). STORM errors already handled — same pattern extends to new modes.
- **State lifecycle risks:** NotebookLM sessions may expire. Cross-feature sessionStorage data is one-time-use (read and clear). Engine selection persists per-page independently.
- **API surface parity:** Existing API routes gain an `engine` parameter but default to `"builtin"` — backward compatible. New endpoints are additive.
- **Integration coverage:** Cross-feature flow (gaps → ideas, assumptions → theories) creates new coupling between pages that needs testing as a workflow, not just individually.
- **Unchanged invariants:** Existing STORM behavior preserved when engine="storm". Existing search pipeline unchanged when no journal filters configured. Existing paper analysis (aiAnalysis field) unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `notebooklm-py` auth is browser-based (fragile) | Bridge script returns clear auth errors; settings page shows auth status; fallback to MCP tools if needed |
| Large paper collections may exceed LLM context for field takeaways | Slice fullText to 6000 chars per paper; limit to 20 papers per request; summarize in batches if needed |
| Journal name normalization may miss some matches | Use existing `normalizeJournalName` which already handles abbreviations, case, unicode; add manual override in UI |
| NotebookLM rate limits unknown | Batch in groups of 5 with delays; report per-paper status so user sees progress |

## Sources & References

- Related code: `src/lib/sources/aggregator.ts`, `src/lib/research/storm-review.ts`, `scripts/storm-bridge.py`
- External: [notebooklm-py](https://github.com/teng-lin/notebooklm-py) (12.3k stars)
- External: [PyPaperBot](https://github.com/ferru97/PyPaperBot) — CSV journal filter pattern
- External: [PaperQA2](https://github.com/Future-House/paper-qa) — cross-paper contradiction detection reference
- External: [Ai2 ScholarQA](https://github.com/allenai/ai2-scholarqa-lib) — comparison table generation reference
