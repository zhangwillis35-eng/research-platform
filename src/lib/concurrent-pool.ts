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
  onProgress?: (completed: number, total: number, result: PoolResult<R>) => void
): Promise<PoolResult<R>[]> {
  const results: PoolResult<R>[] = new Array(items.length);
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
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
  return results;
}
