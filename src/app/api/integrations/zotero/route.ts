import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractText } from "unpdf";
import {
  getZoteroItems,
  getZoteroCollections,
  addToZotero,
  exportZoteroCitations,
  batchAddToZotero,
  createZoteroCollection,
  importFromZotero,
  downloadZoteroPDF,
} from "@/lib/integrations/zotero";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, apiKey, userId, ...params } = body as {
      action: string;
      apiKey: string;
      userId: string;
      [key: string]: unknown;
    };

    if (!apiKey || !userId) {
      return NextResponse.json(
        { error: "Zotero API key and user ID required" },
        { status: 400 }
      );
    }

    const config = { apiKey, userId };

    switch (action) {
      case "items": {
        const items = await getZoteroItems(
          config,
          (params.limit as number) ?? 50,
          params.collectionKey as string | undefined
        );
        return NextResponse.json({ items });
      }

      case "collections": {
        const collections = await getZoteroCollections(config);
        return NextResponse.json({ collections });
      }

      case "add": {
        const success = await addToZotero(
          config,
          params.paper as {
            title: string;
            authors: { name: string }[];
            year?: number;
            venue?: string;
            doi?: string;
            abstract?: string;
          },
          params.collectionKey as string | undefined
        );
        return NextResponse.json({ success });
      }

      case "batch-add": {
        const result = await batchAddToZotero(
          config,
          params.papers as Array<{
            title: string;
            authors: { name: string }[];
            year?: number;
            venue?: string;
            doi?: string;
            abstract?: string;
          }>,
          params.collectionKey as string | undefined
        );
        return NextResponse.json(result);
      }

      case "create-collection": {
        const key = await createZoteroCollection(
          config,
          params.name as string,
          params.parentKey as string | undefined
        );
        return NextResponse.json({ key });
      }

      case "export": {
        const citations = await exportZoteroCitations(
          config,
          params.itemKeys as string[],
          (params.format as "apa" | "bibtex" | "ris") ?? "apa"
        );
        return NextResponse.json({ citations });
      }

      case "import": {
        // Import from Zotero → ScholarFlow database
        const projectId = params.projectId as string;
        const collectionKey = params.collectionKey as string | undefined;
        const downloadPDFs = (params.downloadPDFs as boolean) ?? true;

        if (!projectId) {
          return NextResponse.json({ error: "projectId required" }, { status: 400 });
        }

        const { items } = await importFromZotero(config, collectionKey, 200);

        let imported = 0;
        let skipped = 0;
        let withPDF = 0;

        for (const item of items) {
          // Dedup by DOI or title
          const existing = item.doi
            ? await prisma.paper.findFirst({
                where: { projectId, doi: item.doi },
              })
            : await prisma.paper.findFirst({
                where: {
                  projectId,
                  title: { equals: item.title, mode: "insensitive" },
                },
              });

          if (existing) {
            skipped++;
            continue;
          }

          // Download PDF and extract text if available
          let fullText: string | null = null;
          let pdfFileName: string | null = null;

          if (downloadPDFs && item.attachmentKeys.length > 0) {
            try {
              const pdfBuffer = await downloadZoteroPDF(config, item.attachmentKeys[0]);
              if (pdfBuffer && pdfBuffer.length > 0) {
                const { text } = await extractText(new Uint8Array(pdfBuffer), { mergePages: true });
                if (text && text.trim().length > 100) {
                  fullText = text.trim();
                  pdfFileName = `zotero-${item.zoteroKey}.pdf`;
                  withPDF++;
                }
              }
            } catch {
              // PDF download/extraction failed — continue without fullText
            }
          }

          await prisma.paper.create({
            data: {
              projectId,
              title: item.title,
              abstract: item.abstract ?? null,
              authors: item.authors,
              year: item.year,
              venue: item.venue,
              doi: item.doi,
              citationCount: 0,
              referenceCount: 0,
              source: "manual",
              fullText,
              pdfFileName,
            },
          });
          imported++;
        }

        return NextResponse.json({
          imported,
          skipped,
          withPDF,
          total: items.length,
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Zotero operation failed", details: String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
