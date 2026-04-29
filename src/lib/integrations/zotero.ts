/**
 * Zotero Web API integration.
 *
 * Docs: https://www.zotero.org/support/dev/web_api/v3/start
 * - Read user's library items
 * - Export citations in various formats
 * - Import items from ScholarFlow
 *
 * Auth: API key from https://www.zotero.org/settings/keys/new
 */
/**
 * Fetch for Zotero API — uses undici directly to bypass Node.js proxy env vars.
 */
import { fetch as undiciFetch } from "undici";

async function zoteroFetch(url: string, init?: RequestInit & { body?: string }): Promise<Response> {
  const res = await undiciFetch(url, init as Parameters<typeof undiciFetch>[1]);
  return res as unknown as Response;
}

const ZOTERO_BASE = "https://api.zotero.org";

export interface ZoteroConfig {
  apiKey: string;
  userId: string; // Zotero user ID (numeric)
}

export interface ZoteroItem {
  key: string;
  title: string;
  creators: Array<{ firstName?: string; lastName?: string; name?: string; creatorType: string }>;
  date?: string;
  publicationTitle?: string;
  DOI?: string;
  abstractNote?: string;
  url?: string;
  itemType: string;
  tags: Array<{ tag: string }>;
}

// ─── Read library ──────────────────────────────

export async function getZoteroItems(
  config: ZoteroConfig,
  limit: number = 50,
  collectionKey?: string
): Promise<ZoteroItem[]> {
  const base = `${ZOTERO_BASE}/users/${config.userId}`;
  const path = collectionKey
    ? `${base}/collections/${collectionKey}/items`
    : `${base}/items`;

  const params = new URLSearchParams({
    format: "json",
    limit: String(limit),
    sort: "dateModified",
    direction: "desc",
    itemType: "-attachment || note",
  });

  const res = await zoteroFetch(`${path}?${params}`, {
    headers: {
      "Zotero-API-Key": config.apiKey,
      "Zotero-API-Version": "3",
    },
  });

  if (!res.ok) {
    throw new Error(`Zotero API error: ${res.status}`);
  }

  const items = (await res.json()) as Array<{ key: string; data: Record<string, unknown> }>;

  return items.map((item) => ({
    key: item.key,
    title: (item.data.title as string) ?? "",
    creators: (item.data.creators as ZoteroItem["creators"]) ?? [],
    date: item.data.date as string | undefined,
    publicationTitle: item.data.publicationTitle as string | undefined,
    DOI: item.data.DOI as string | undefined,
    abstractNote: item.data.abstractNote as string | undefined,
    url: item.data.url as string | undefined,
    itemType: item.data.itemType as string,
    tags: (item.data.tags as ZoteroItem["tags"]) ?? [],
  }));
}

// ─── Get collections ────────────────────────────

export async function getZoteroCollections(
  config: ZoteroConfig
): Promise<Array<{ key: string; name: string; numItems: number }>> {
  const res = await zoteroFetch(
    `${ZOTERO_BASE}/users/${config.userId}/collections?format=json&limit=100`,
    {
      headers: {
        "Zotero-API-Key": config.apiKey,
        "Zotero-API-Version": "3",
      },
    }
  );

  if (!res.ok) throw new Error(`Zotero API error: ${res.status}`);

  const collections = (await res.json()) as Array<{
    key: string;
    data: { name: string };
    meta: { numItems: number };
  }>;

  return collections.map((c) => ({
    key: c.key,
    name: c.data.name,
    numItems: c.meta.numItems,
  }));
}

// ─── Export citations from Zotero ───────────────

export async function exportZoteroCitations(
  config: ZoteroConfig,
  itemKeys: string[],
  format: "apa" | "bibtex" | "ris" = "apa"
): Promise<string> {
  const formatMap = { apa: "apa", bibtex: "bibtex", ris: "ris" };
  const styleMap = { apa: "apa", bibtex: "bibtex", ris: "ris" };

  const res = await zoteroFetch(
    `${ZOTERO_BASE}/users/${config.userId}/items?itemKey=${itemKeys.join(",")}&format=${formatMap[format]}${format === "apa" ? "&style=apa" : ""}`,
    {
      headers: {
        "Zotero-API-Key": config.apiKey,
        "Zotero-API-Version": "3",
      },
    }
  );

  if (!res.ok) throw new Error(`Zotero export error: ${res.status}`);
  return res.text();
}

// ─── Add paper to Zotero ────────────────────────

export async function addToZotero(
  config: ZoteroConfig,
  paper: {
    title: string;
    authors: { name: string }[];
    year?: number;
    venue?: string;
    doi?: string;
    abstract?: string;
    url?: string;
  },
  collectionKey?: string
): Promise<boolean> {
  const creators = paper.authors.map((a) => {
    const parts = a.name.split(" ");
    return {
      creatorType: "author",
      firstName: parts.slice(0, -1).join(" ") || a.name,
      lastName: parts[parts.length - 1] || "",
    };
  });

  const item: Record<string, unknown> = {
    itemType: "journalArticle",
    title: paper.title,
    creators,
    date: paper.year ? String(paper.year) : undefined,
    publicationTitle: paper.venue,
    DOI: paper.doi,
    abstractNote: paper.abstract,
    url: paper.url,
    collections: collectionKey ? [collectionKey] : [],
  };

  const res = await zoteroFetch(
    `${ZOTERO_BASE}/users/${config.userId}/items`,
    {
      method: "POST",
      headers: {
        "Zotero-API-Key": config.apiKey,
        "Zotero-API-Version": "3",
        "Content-Type": "application/json",
      },
      body: JSON.stringify([item]),
    }
  );

  return res.ok;
}

// ─── Convert Zotero items to our UnifiedPaper format ──

export function zoteroToUnifiedPaper(item: ZoteroItem) {
  const authors = item.creators
    .filter((c) => c.creatorType === "author")
    .map((c) => ({
      name: c.name ?? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
    }));

  const year = item.date ? parseInt(item.date.slice(0, 4)) : undefined;

  return {
    title: item.title,
    abstract: item.abstractNote,
    authors,
    year: isNaN(year ?? NaN) ? undefined : year,
    venue: item.publicationTitle,
    doi: item.DOI,
    citationCount: 0,
    referenceCount: 0,
    source: "manual" as const,
  };
}

// ─── Batch add papers to Zotero ────────────────

export async function batchAddToZotero(
  config: ZoteroConfig,
  papers: Array<{
    title: string;
    authors: { name: string }[];
    year?: number;
    venue?: string;
    doi?: string;
    abstract?: string;
  }>,
  collectionKey?: string
): Promise<{ success: number; failed: number }> {
  // Zotero accepts up to 50 items per request
  const BATCH = 50;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < papers.length; i += BATCH) {
    const batch = papers.slice(i, i + BATCH);
    const items = batch.map((paper) => ({
      itemType: "journalArticle",
      title: paper.title,
      creators: paper.authors.map((a) => {
        const parts = a.name.split(" ");
        return {
          creatorType: "author",
          firstName: parts.slice(0, -1).join(" ") || a.name,
          lastName: parts[parts.length - 1] || "",
        };
      }),
      date: paper.year ? String(paper.year) : undefined,
      publicationTitle: paper.venue,
      DOI: paper.doi,
      abstractNote: paper.abstract,
      collections: collectionKey ? [collectionKey] : [],
    }));

    try {
      const res = await zoteroFetch(
        `${ZOTERO_BASE}/users/${config.userId}/items`,
        {
          method: "POST",
          headers: {
            "Zotero-API-Key": config.apiKey,
            "Zotero-API-Version": "3",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(items),
        }
      );

      if (res.ok) {
        const data = (await res.json()) as {
          success: Record<string, string>;
          failed: Record<string, unknown>;
        };
        success += Object.keys(data.success ?? {}).length;
        failed += Object.keys(data.failed ?? {}).length;
      } else {
        failed += batch.length;
      }
    } catch {
      failed += batch.length;
    }
  }

  return { success, failed };
}

// ─── Create collection ────────────────────────

export async function createZoteroCollection(
  config: ZoteroConfig,
  name: string,
  parentKey?: string
): Promise<string | null> {
  const res = await zoteroFetch(
    `${ZOTERO_BASE}/users/${config.userId}/collections`,
    {
      method: "POST",
      headers: {
        "Zotero-API-Key": config.apiKey,
        "Zotero-API-Version": "3",
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        { name, parentCollection: parentKey ?? false },
      ]),
    }
  );

  if (!res.ok) return null;
  const data = (await res.json()) as { success: Record<string, string> };
  return Object.values(data.success ?? {})[0] ?? null;
}

// ─── Download PDF attachment from Zotero ──────

export async function getZoteroAttachments(
  config: ZoteroConfig,
  parentItemKey: string
): Promise<Array<{ key: string; filename: string; contentType: string }>> {
  const res = await zoteroFetch(
    `${ZOTERO_BASE}/users/${config.userId}/items/${parentItemKey}/children?format=json`,
    {
      headers: {
        "Zotero-API-Key": config.apiKey,
        "Zotero-API-Version": "3",
      },
    }
  );

  if (!res.ok) return [];

  const children = (await res.json()) as Array<{
    key: string;
    data: { itemType: string; filename?: string; contentType?: string };
  }>;

  return children
    .filter((c) => c.data.itemType === "attachment" && c.data.contentType === "application/pdf")
    .map((c) => ({
      key: c.key,
      filename: c.data.filename ?? "document.pdf",
      contentType: c.data.contentType ?? "application/pdf",
    }));
}

export async function downloadZoteroPDF(
  config: ZoteroConfig,
  attachmentKey: string
): Promise<Buffer | null> {
  const res = await zoteroFetch(
    `${ZOTERO_BASE}/users/${config.userId}/items/${attachmentKey}/file`,
    {
      headers: {
        "Zotero-API-Key": config.apiKey,
        "Zotero-API-Version": "3",
      },
      redirect: "follow",
    }
  );

  if (!res.ok) return null;

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Import from Zotero to ScholarFlow ────────

export async function importFromZotero(
  config: ZoteroConfig,
  collectionKey?: string,
  limit: number = 100
): Promise<{
  items: Array<ReturnType<typeof zoteroToUnifiedPaper> & { zoteroKey: string; attachmentKeys: string[] }>;
  total: number;
}> {
  // Fetch items
  const items = await getZoteroItems(config, limit, collectionKey);

  // For each item, check for PDF attachments
  const results = await Promise.all(
    items.map(async (item) => {
      const paper = zoteroToUnifiedPaper(item);
      let attachmentKeys: string[] = [];

      try {
        const attachments = await getZoteroAttachments(config, item.key);
        attachmentKeys = attachments.map((a) => a.key);
      } catch {
        // Skip attachment lookup failures
      }

      return {
        ...paper,
        zoteroKey: item.key,
        attachmentKeys,
      };
    })
  );

  return { items: results, total: items.length };
}
