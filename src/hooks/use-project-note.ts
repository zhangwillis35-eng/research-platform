"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type NoteSection =
  | "review"
  | "graph"
  | "analysis"
  | "ideas"
  | "theories"
  | "model"
  | "proposal";

export function useProjectNote(projectId: string, section: NoteSection) {
  const [content, setContent] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);

  // Load on mount
  useEffect(() => {
    fetch(`/api/projects/${projectId}/note?section=${section}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.content) setContent(d.content);
        if (d.updatedAt) setSavedAt(d.updatedAt);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [projectId, section]);

  // Debounced auto-save
  const save = useCallback(
    (text: string) => {
      pendingRef.current = text;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        const toSave = pendingRef.current;
        if (toSave === null) return;
        pendingRef.current = null;
        setSaving(true);
        try {
          const res = await fetch(`/api/projects/${projectId}/note`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ section, content: toSave }),
          });
          if (res.ok) {
            const d = await res.json();
            setSavedAt(d.updatedAt);
          }
        } catch { /* silent */ }
        setSaving(false);
      }, 800);
    },
    [projectId, section]
  );

  const handleChange = useCallback(
    (text: string) => {
      setContent(text);
      save(text);
    },
    [save]
  );

  return { content, handleChange, savedAt, saving, loaded };
}
