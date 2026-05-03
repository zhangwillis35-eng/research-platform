/**
 * Cross-feature data flow — enables seamless data passing between pages.
 *
 * Uses sessionStorage with namespaced keys. Data is one-time-use:
 * read once and cleared to prevent stale pre-fills.
 *
 * Flow examples:
 *   Field takeaways gaps → Ideas page (pre-filled gap seeds)
 *   Assumptions → Theories page (pre-filled boundary conditions)
 *   Field takeaways → Review page (pre-filled context)
 */

export type CrossFeatureTarget = "ideas" | "theories" | "review" | "graph";

interface CrossFeatureData {
  source: string; // e.g. "field-takeaways", "assumptions"
  content: string;
  timestamp: number;
  projectId: string;
}

const PREFIX = "sf:crossfeature:";

/**
 * Set cross-feature data for a target page.
 * Call this before navigating to the target page.
 */
export function setCrossFeatureData(
  target: CrossFeatureTarget,
  projectId: string,
  source: string,
  content: string,
): void {
  if (typeof window === "undefined") return;
  const key = `${PREFIX}${target}:${projectId}`;
  const data: CrossFeatureData = {
    source,
    content,
    timestamp: Date.now(),
    projectId,
  };
  sessionStorage.setItem(key, JSON.stringify(data));
}

/**
 * Get and consume cross-feature data for the current page.
 * Returns null if no data is available or if data is stale (>10 minutes).
 * Data is cleared after reading (one-time consumption).
 */
export function consumeCrossFeatureData(
  target: CrossFeatureTarget,
  projectId: string,
): CrossFeatureData | null {
  if (typeof window === "undefined") return null;
  const key = `${PREFIX}${target}:${projectId}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;

  try {
    const data: CrossFeatureData = JSON.parse(raw);
    // Verify projectId matches
    if (data.projectId !== projectId) {
      sessionStorage.removeItem(key);
      return null;
    }
    // Check staleness (10 minutes)
    if (Date.now() - data.timestamp > 10 * 60 * 1000) {
      sessionStorage.removeItem(key);
      return null;
    }
    // Consume (one-time read)
    sessionStorage.removeItem(key);
    return data;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}
