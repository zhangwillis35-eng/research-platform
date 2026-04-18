const BASE_URL = "https://api.unpaywall.org/v2";
const EMAIL = process.env.OPENALEX_EMAIL || "scholarflow@research.app";

export interface UnpaywallResult {
  isOpenAccess: boolean;
  oaUrl?: string;
  oaLocation?: string; // "publisher" | "repository" | "other"
  license?: string;
}

export async function findOpenAccess(doi: string): Promise<UnpaywallResult> {
  if (!doi) return { isOpenAccess: false };

  try {
    const res = await fetch(
      `${BASE_URL}/${encodeURIComponent(doi)}?email=${EMAIL}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!res.ok) return { isOpenAccess: false };

    const data = await res.json();

    const bestOa = data.best_oa_location;
    if (!bestOa) return { isOpenAccess: false };

    return {
      isOpenAccess: true,
      oaUrl: bestOa.url_for_pdf ?? bestOa.url,
      oaLocation: bestOa.host_type,
      license: bestOa.license,
    };
  } catch {
    return { isOpenAccess: false };
  }
}

// Batch lookup for multiple DOIs
export async function batchFindOpenAccess(
  dois: string[]
): Promise<Map<string, UnpaywallResult>> {
  const results = new Map<string, UnpaywallResult>();

  // Process in parallel with concurrency limit of 10
  const batchSize = 10;
  for (let i = 0; i < dois.length; i += batchSize) {
    const batch = dois.slice(i, i + batchSize);
    const promises = batch.map(async (doi) => {
      const result = await findOpenAccess(doi);
      results.set(doi, result);
    });
    await Promise.all(promises);
  }

  return results;
}
