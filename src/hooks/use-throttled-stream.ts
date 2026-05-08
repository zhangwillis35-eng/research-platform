/**
 * Throttled text accumulator for streaming SSE output.
 *
 * Problem: each SSE chunk triggers setState → React re-render.
 * With 20-50 events/sec, this causes visible jank on long texts.
 *
 * Solution: accumulate chunks in a ref, flush to state via
 * requestAnimationFrame (~60fps max, typically 16ms intervals).
 * This batches multiple chunks into a single re-render.
 *
 * Usage:
 *   const { append, getText, reset, flush } = useThrottledStream(setText);
 *   // In SSE loop: append(chunk)
 *   // After stream ends: flush()
 */
import { useRef, useCallback } from "react";

export function useThrottledStream(
  setter: (text: string) => void
) {
  const bufRef = useRef("");
  const rafRef = useRef<number | null>(null);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      setter(bufRef.current);
      rafRef.current = null;
    });
  }, [setter]);

  const append = useCallback(
    (chunk: string) => {
      bufRef.current += chunk;
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const flush = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setter(bufRef.current);
  }, [setter]);

  const reset = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    bufRef.current = "";
  }, []);

  const getText = useCallback(() => bufRef.current, []);

  return { append, getText, flush, reset };
}
