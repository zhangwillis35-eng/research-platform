/**
 * Concurrent task pool — runs up to `concurrency` async tasks in parallel.
 * Returns results in the same order as the input items.
 *
 * Optional `onProgress` callback fires after each task settles.
 */
export interface PoolResult<T> {
  status: "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
  index: number;
}

export async function concurrentPool<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
  onProgress?: (completed: number, total: number, result: PoolResult<R>) => void,
  signal?: AbortSignal
): Promise<PoolResult<R>[]> {
  const results: PoolResult<R>[] = new Array(items.length);
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      // Stop claiming new items once the caller aborted (client disconnect / stop button)
      if (signal?.aborted) break;
      const idx = cursor++;
      try {
        const value = await fn(items[idx], idx);
        results[idx] = { status: "fulfilled", value, index: idx };
      } catch (reason) {
        results[idx] = { status: "rejected", reason, index: idx };
      }
      completed++;
      onProgress?.(completed, items.length, results[idx]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);

  // Fill slots for items that never ran (aborted before being claimed) so the
  // returned array has no holes. No onProgress for these — they never executed.
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      results[i] = {
        status: "rejected",
        reason: new DOMException("Aborted", "AbortError"),
        index: i,
      };
    }
  }

  return results;
}
