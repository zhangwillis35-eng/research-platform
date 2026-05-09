/**
 * BackgroundSearchManager — singleton that keeps search running across page navigation.
 *
 * In Next.js App Router, client-side <Link> navigation preserves the JS context.
 * This module-level singleton continues processing the SSE stream even when the
 * search page component unmounts. Results are stored in sessionStorage.
 *
 * Flow:
 *   1. Search page calls searchManager.startSearch()
 *   2. User navigates to another section
 *   3. SSE stream continues processing in background (JS context alive)
 *   4. Results accumulate in sessionStorage
 *   5. User returns to search page → reads results from sessionStorage
 */

export interface SearchProgress {
  phase: string;
  message: string;
  done: boolean;
}

export interface SearchJobState {
  status: "idle" | "searching" | "done" | "error";
  progress: SearchProgress[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any | null; // The final SmartSearchResult
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  /** Set to true after the result has been consumed by handleSearchResult */
  consumed: boolean;
}

type Listener = (state: SearchJobState) => void;

const STORAGE_KEY = "sf:search-job";

class BackgroundSearchManager {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private state: SearchJobState = this.loadState();
  private listeners = new Set<Listener>();
  private abortController: AbortController | null = null;

  /** Whether a search is currently running */
  get isRunning(): boolean {
    return this.state.status === "searching";
  }

  /** Get current state */
  getState(): SearchJobState {
    return this.state;
  }

  /**
   * Start a background search. The SSE stream is processed in the module scope —
   * it continues even if the React component unmounts.
   */
  async startSearch(body: {
    query: string;
    provider: string;
    limit: number;
    enableRelevanceScoring: boolean;
    stream: boolean;
    projectId?: string;
    journalLang?: "en" | "zh";
  }): Promise<void> {
    // Cancel any existing search
    this.abort();

    this.abortController = new AbortController();

    this.state = {
      status: "searching",
      progress: [],
      result: null,
      error: null,
      startedAt: Date.now(),
      completedAt: null,
      consumed: false,
    };
    this.notify();
    this.saveState();

    try {
      const res = await fetch("/api/research/smart-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!res.ok || !res.body) {
        this.state.status = "error";
        this.state.error = `HTTP ${res.status}`;
        this.notify();
        this.saveState();
        return;
      }

      this.reader = res.body.getReader();
      await this.processStream(this.reader);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled — keep whatever results we have
        if (this.state.status === "searching") {
          this.state.status = this.state.result ? "done" : "idle";
        }
        this.notify();
        this.saveState();
        return;
      }

      // SSE stream failed — if we already have partial results, use them
      if (this.state.result?.papers?.length > 0) {
        console.log(`[search-manager] SSE stream failed but have ${this.state.result.papers.length} papers, treating as success`);
        this.state.status = "done";
        this.state.completedAt = Date.now();
        this.state.consumed = false;
        this.state.progress = this.state.progress.map((s) => ({ ...s, done: true }));
        this.notify();
        this.saveState();
        this.saveResult();
        return;
      }

      // No partial results and no retry — show error
      this.state.status = "error";
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      this.saveState();
    }
  }

  /** Process SSE stream — runs in module scope, survives component unmount */
  private async processStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "status") {
              const phase = evt.phase ?? "";
              const last = this.state.progress[this.state.progress.length - 1];
              if (last && !last.done && last.phase === phase) {
                // Same phase — update in place (e.g. scoring progress 10/100 → 20/100)
                this.state.progress = [
                  ...this.state.progress.slice(0, -1),
                  { phase, message: evt.message, done: false },
                ];
              } else {
                // New phase — mark previous as done, add new entry
                this.state.progress = [
                  ...this.state.progress.map((s) => ({ ...s, done: true })),
                  { phase, message: evt.message, done: false },
                ];
              }
              this.notify();
              this.saveState();
            } else if (evt.type === "fulltext_update") {
              // Update a paper's full text status after results were already delivered
              if (this.state.result?.papers) {
                for (const p of this.state.result.papers) {
                  if ((p.doi && p.doi === evt.doi) || p.title === evt.title) {
                    p.hasFullText = true;
                    p.fullTextSource = evt.fullTextSource;
                    p.fullTextWordCount = evt.fullTextWordCount;
                    p.fullText = evt.fullText;
                    break;
                  }
                }
                this.notify();
              }
            } else if (evt.type === "papers_chunk") {
              // Accumulate paper chunks into result
              if (!this.state.result) {
                this.state.result = { papers: [], stats: null, keywords: [] };
              }
              this.state.result.papers = [
                ...(this.state.result.papers ?? []),
                ...(evt.papers ?? []),
              ];
              this.notify();
            } else if (evt.type === "result") {
              // Legacy single-result event (backwards compat)
              this.state.result = evt;
              this.notify();
            } else if (evt.type === "done") {
              // Merge stats/keywords from done event into accumulated result
              if (this.state.result && evt.stats) {
                this.state.result.stats = evt.stats;
                this.state.result.plan = evt.plan;
              }
              // Only fire "done" once — prevent duplicate from stream-end fallback
              if (this.state.status !== "done") {
                this.state.status = "done";
                this.state.completedAt = Date.now();
                this.state.consumed = false;
                this.state.progress = this.state.progress.map((s) => ({
                  ...s,
                  done: true,
                }));
                this.notify();
                this.saveState();
                this.saveResult();
              }
            } else if (evt.type === "error") {
              this.state.status = "error";
              this.state.error = evt.details || evt.error;
              this.notify();
              this.saveState();
            }
          } catch {
            // Skip malformed SSE
          }
        }
      }

      // Stream ended naturally
      if (this.state.status === "searching") {
        this.state.status = this.state.result ? "done" : "error";
        this.state.completedAt = Date.now();
        this.state.progress = this.state.progress.map((s) => ({
          ...s,
          done: true,
        }));
        if (!this.state.result) this.state.error = "Stream ended without result";
        this.notify();
        this.saveState();
        this.saveResult();
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        // If we have partial results (papers received before stream broke), keep them
        if (this.state.result?.papers?.length > 0) {
          this.state.status = "done";
          this.state.completedAt = Date.now();
          this.state.consumed = false;
          this.state.progress = this.state.progress.map((s) => ({ ...s, done: true }));
          this.notify();
          this.saveState();
          this.saveResult();
          return;
        }
        // No partial results — propagate error (will trigger non-streaming retry in startSearch)
        this.state.status = "error";
        this.state.error = err instanceof Error ? err.message : String(err);
        this.notify();
        this.saveState();
      }
    }
  }

  /** Abort the current search */
  abort() {
    this.abortController?.abort();
    this.abortController = null;
    this.reader = null;
  }

  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Send current state immediately
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** Mark the current result as consumed (prevents re-processing on remount) */
  markConsumed() {
    this.state.consumed = true;
  }

  /** Reset to idle */
  reset() {
    this.abort();
    this.state = {
      status: "idle",
      progress: [],
      result: null,
      error: null,
      startedAt: 0,
      completedAt: null,
      consumed: false,
    };
    this.notify();
    this.saveState();
    try { sessionStorage.removeItem(STORAGE_KEY + ":result"); } catch {}
  }

  private notify() {
    for (const listener of this.listeners) {
      try { listener(this.state); } catch {}
    }
  }

  private saveState() {
    try {
      const { result, ...rest } = this.state;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {}
  }

  private saveResult() {
    if (!this.state.result) return;
    try {
      // Strip fullText from papers to fit in sessionStorage
      const result = { ...this.state.result };
      if (result.papers) {
        result.papers = result.papers.map((p: Record<string, unknown>) => {
          const { fullText, ...rest } = p;
          return rest;
        });
      }
      sessionStorage.setItem(STORAGE_KEY + ":result", JSON.stringify(result));
    } catch {
      // sessionStorage full — skip
    }
  }

  private loadState(): SearchJobState {
    const defaultState: SearchJobState = {
      status: "idle",
      progress: [],
      result: null,
      error: null,
      startedAt: 0,
      completedAt: null,
      consumed: false,
    };

    if (typeof window === "undefined") return defaultState;

    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return defaultState;

      const state = JSON.parse(stored) as SearchJobState;
      // If was searching when page refreshed, mark as done/error
      if (state.status === "searching") {
        state.status = "error";
        state.error = "页面刷新导致搜索中断。请重新搜索。";
      }

      // Load result separately
      const resultStr = sessionStorage.getItem(STORAGE_KEY + ":result");
      if (resultStr) {
        state.result = JSON.parse(resultStr);
      }

      return state;
    } catch {
      return defaultState;
    }
  }
}

/** Module-level singleton — persists across client-side navigations */
export const searchManager = new BackgroundSearchManager();
