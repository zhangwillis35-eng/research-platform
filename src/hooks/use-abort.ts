"use client";

import { useRef, useCallback } from "react";

/**
 * Hook providing an AbortController for cancelling LLM fetch/stream calls.
 *
 * Usage:
 *   const { signal, abort, reset } = useAbort();
 *   // In fetch: fetch(url, { signal })
 *   // On stop button: abort()
 *   // Before new request: reset() — creates a fresh controller
 */
export function useAbort() {
  const controllerRef = useRef<AbortController | null>(null);

  /** Get the current signal, creating a controller if needed. */
  const getSignal = useCallback(() => {
    if (!controllerRef.current || controllerRef.current.signal.aborted) {
      controllerRef.current = new AbortController();
    }
    return controllerRef.current.signal;
  }, []);

  /** Abort the current request. Safe to call multiple times. */
  const abort = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  /** Reset — creates a fresh controller. Call before starting a new request. */
  const reset = useCallback(() => {
    controllerRef.current = new AbortController();
    return controllerRef.current.signal;
  }, []);

  return { getSignal, abort, reset };
}
