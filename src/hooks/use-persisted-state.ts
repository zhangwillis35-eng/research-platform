"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * useState that persists across both page navigation AND page refresh.
 *
 * Uses sessionStorage as the backing store (survives refresh, cleared on tab close).
 * Handles Set, Map, and Date serialization automatically.
 * Strips large fields (fullText) from paper arrays to stay under sessionStorage limits.
 *
 * Usage:
 *   const [papers, setPapers] = usePersistedState<Paper[]>("search", "papers", []);
 */

// ─── Serialization helpers ───────────────────────

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val instanceof Set) return { __type: "Set", data: [...val] };
    if (val instanceof Map) return { __type: "Map", data: [...val.entries()] };
    // Strip fullText from paper objects to save space
    if (val && typeof val === "object" && "fullText" in val && "title" in val) {
      const { fullText, ...rest } = val as Record<string, unknown>;
      return { ...rest, __hadFullText: !!fullText };
    }
    return val;
  });
}

function deserialize<T>(json: string): T {
  return JSON.parse(json, (_key, val) => {
    if (val && typeof val === "object") {
      if (val.__type === "Set") return new Set(val.data);
      if (val.__type === "Map") return new Map(val.data);
    }
    return val;
  }) as T;
}

function storageKey(namespace: string, key: string): string {
  return `sf:${namespace}::${key}`;
}

// ─── Hook ────────────────────────────────────────

export function usePersistedState<T>(
  namespace: string,
  key: string,
  initialValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const sKey = storageKey(namespace, key);
  const initialized = useRef(false);

  // Always initialize with initialValue to match SSR — hydrate from storage in useEffect
  const [value, setValueRaw] = useState<T>(initialValue);

  // Hydrate from sessionStorage AFTER mount (avoids hydration mismatch)
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const stored = sessionStorage.getItem(sKey);
      if (stored !== null) {
        const restored = deserialize<T>(stored);
        setValueRaw(restored);
      }
    } catch {
      // sessionStorage not available or parse error
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to sessionStorage on every change (debounced)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistToStorage = useCallback(
    (val: T) => {
      if (typeof window === "undefined") return;
      // Debounce writes to avoid thrashing sessionStorage during rapid updates
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        try {
          const serialized = serialize(val);
          // Skip if too large (> 500KB per key)
          if (serialized.length > 500_000) {
            console.warn(`[persist] Skipping ${sKey}: ${(serialized.length / 1024).toFixed(0)}KB exceeds limit`);
            return;
          }
          sessionStorage.setItem(sKey, serialized);
        } catch {
          // sessionStorage full — clear old entries and retry
          try {
            clearOldEntries(namespace);
            sessionStorage.setItem(sKey, serialize(val));
          } catch {
            // Give up silently
          }
        }
      }, 100);
    },
    [sKey, namespace]
  );

  // Wrapped setter
  const setValue = useCallback(
    (action: React.SetStateAction<T>) => {
      setValueRaw((prev) => {
        const next =
          typeof action === "function"
            ? (action as (prev: T) => T)(prev)
            : action;
        persistToStorage(next);
        return next;
      });
    },
    [persistToStorage]
  );


  return [value, setValue];
}

// ─── Utilities ───────────────────────────────────

/**
 * Clear all persisted state for a namespace.
 */
export function clearPersistedState(namespace: string): void {
  if (typeof window === "undefined") return;
  const prefix = `sf:${namespace}::`;
  const keys: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  keys.forEach((k) => sessionStorage.removeItem(k));
}

/**
 * Clear oldest entries when sessionStorage is full.
 */
function clearOldEntries(currentNamespace: string): void {
  const toRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k?.startsWith("sf:") && !k.startsWith(`sf:${currentNamespace}::`)) {
      toRemove.push(k);
    }
  }
  // Remove up to 10 entries from other namespaces
  toRemove.slice(0, 10).forEach((k) => sessionStorage.removeItem(k));
}
