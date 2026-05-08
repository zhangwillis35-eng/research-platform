/**
 * Extract embedded images from PDF using MuPDF (WASM).
 *
 * Walks each page's Resources → XObject dict, finds entries with
 * /Subtype /Image, loads them via PDFDocument.loadImage(), and
 * converts to PNG via Pixmap.asPNG().
 *
 * Falls back to full-page render if no discrete images are found.
 */

export interface ExtractedImage {
  /** Label: "图1", "图2", ... */
  label: string;
  /** Page number (1-indexed) where the image was found */
  page: number;
  /** PNG bytes */
  png: Uint8Array;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
}

export async function extractImagesFromPdf(
  pdfBytes: Uint8Array | ArrayBuffer,
  maxImages = 30
): Promise<ExtractedImage[]> {
  const mupdf = await import("mupdf");
  const buf = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);

  const doc = mupdf.Document.openDocument(buf, "application/pdf") as InstanceType<typeof mupdf.PDFDocument>;
  const pdfDoc = doc.asPDF();
  if (!pdfDoc) return [];

  const images: ExtractedImage[] = [];
  const pageCount = doc.countPages();
  let imgIndex = 1;

  for (let p = 0; p < pageCount && images.length < maxImages; p++) {
    try {
      const page = pdfDoc.loadPage(p);
      const pageObj = page.getObject();

      // Navigate: Page → Resources → XObject
      const resources = pageObj.get("Resources");
      if (!resources || resources.isNull()) continue;
      const xobjects = resources.get("XObject");
      if (!xobjects || xobjects.isNull()) continue;

      // Iterate XObject entries
      xobjects.forEach((val: InstanceType<typeof mupdf.PDFObject>, key: string | number) => {
        if (images.length >= maxImages) return;
        try {
          const resolved = val.resolve();
          const subtype = resolved.get("Subtype");
          if (!subtype || subtype.asName() !== "Image") return;

          // Skip tiny images (icons, logos < 50px)
          const w = resolved.get("Width")?.asNumber() ?? 0;
          const h = resolved.get("Height")?.asNumber() ?? 0;
          if (w < 50 || h < 50) return;

          // Load and convert to PNG
          const img = pdfDoc.loadImage(resolved);
          const pixmap = img.toPixmap();
          const png = pixmap.asPNG();

          images.push({
            label: `图${imgIndex}`,
            page: p + 1,
            png,
            width: pixmap.getWidth(),
            height: pixmap.getHeight(),
          });
          imgIndex++;
        } catch {
          // Skip problematic images
        }
      });
    } catch {
      // Skip problematic pages
    }
  }

  return images;
}

/**
 * Render specific PDF pages as PNG images (fallback when discrete
 * image extraction yields nothing useful).
 */
export async function renderPagesAsPng(
  pdfBytes: Uint8Array | ArrayBuffer,
  pageNumbers: number[], // 1-indexed
  scale = 2 // 2x for readability
): Promise<ExtractedImage[]> {
  const mupdf = await import("mupdf");
  const buf = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const results: ExtractedImage[] = [];

  for (const pageNum of pageNumbers) {
    const idx = pageNum - 1;
    if (idx < 0 || idx >= doc.countPages()) continue;
    try {
      const page = doc.loadPage(idx);
      const matrix = mupdf.Matrix.scale(scale, scale);
      const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB);
      const png = pixmap.asPNG();
      results.push({
        label: `第${pageNum}页`,
        page: pageNum,
        png,
        width: pixmap.getWidth(),
        height: pixmap.getHeight(),
      });
    } catch {
      // Skip
    }
  }

  return results;
}
