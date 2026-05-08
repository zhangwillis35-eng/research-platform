import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { extractImagesFromPdf } from "@/lib/pdf-images";

export const maxDuration = 120;

/**
 * POST /api/research/translate/images
 * Body: multipart/form-data with "pdf" file
 *
 * Extracts embedded images from the uploaded PDF via MuPDF WASM
 * and returns them as base64 PNG.
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const formData = await request.formData();
  const pdfFile = formData.get("pdf") as File | null;

  if (!pdfFile) {
    return NextResponse.json({ error: "pdf file required" }, { status: 400 });
  }

  try {
    const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
    const images = await extractImagesFromPdf(pdfBytes, 20);

    const result = images.map((img) => ({
      label: img.label,
      page: img.page,
      width: img.width,
      height: img.height,
      base64: Buffer.from(img.png).toString("base64"),
    }));

    return NextResponse.json({ images: result });
  } catch (err) {
    console.error("[translate/images] MuPDF extraction error:", err);
    return NextResponse.json(
      { error: "Image extraction failed", details: String(err) },
      { status: 500 }
    );
  }
}
