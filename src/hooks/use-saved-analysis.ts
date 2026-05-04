"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type AnalysisType = "graph" | "ideas" | "theories" | "model" | "review";

/**
 * Hook to persist analysis results to the database.
 * - Loads saved data on mount
 * - Provides save() to persist current results
 * - Shows "已保存" / "上次保存: X" status
 */
export function useSavedAnalysis<T>(projectId: string, type: AnalysisType) {
  const [savedData, setSavedData] = useState<T | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const lastSaveRef = useRef<string>("");

  // Load on mount
  useEffect(() => {
    fetch(`/api/projects/${projectId}/analysis?type=${type}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.data) {
          setSavedData(d.data as T);
          setSavedAt(d.updatedAt);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [projectId, type]);

  // Save
  const save = useCallback(
    async (data: T) => {
      const json = JSON.stringify(data);
      if (json === lastSaveRef.current) return; // skip if unchanged
      lastSaveRef.current = json;

      setSaving(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, data }),
        });
        if (res.ok) {
          const result = await res.json();
          setSavedAt(result.updatedAt);
          setSavedData(data);
        }
      } catch { /* silent */ }
      setSaving(false);
    },
    [projectId, type]
  );

  return { savedData, savedAt, saving, loaded, save };
}
