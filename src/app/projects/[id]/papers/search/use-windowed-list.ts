"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Incremental windowed rendering for long lists — no npm deps.
 *
 * Renders `step` items initially; attach `sentinelRef` to a div after the
 * list and the visible count bumps by `step` whenever it scrolls into view.
 * The window resets to `step` whenever any value in `resetKeys` changes
 * (new search, sort change, filter change, ...).
 *
 * `showAtLeast(n)` force-expands the window so item #n is rendered
 * (used by "jump to paper [N]" links in chat / analysis views).
 */
export function useWindowedList(
  totalCount: number,
  resetKeys: readonly unknown[],
  step = 50
) {
  const [visibleCount, setVisibleCount] = useState(step);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset window when the underlying / derived list changes.
  // Render-phase state adjustment (React's recommended alternative to a
  // reset effect) — avoids a flash of the stale window after a new search.
  const [prevKeys, setPrevKeys] = useState<readonly unknown[]>(resetKeys);
  if (
    resetKeys.length !== prevKeys.length ||
    resetKeys.some((k, i) => !Object.is(k, prevKeys[i]))
  ) {
    setPrevKeys(resetKeys);
    setVisibleCount(step);
  }

  // Observe the sentinel; recreate the observer after each bump so it
  // keeps firing while the sentinel remains in view (fast scrolling).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= totalCount) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => Math.min(c + step, totalCount));
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, totalCount, step]);

  const showAtLeast = useCallback((n: number) => {
    setVisibleCount((c) => (n > c ? n : c));
  }, []);

  return { visibleCount, sentinelRef, showAtLeast };
}
