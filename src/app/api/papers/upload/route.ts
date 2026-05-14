import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { uploadPdf, pdfKey } from "@/lib/oss";

/**
 * POST /api/papers/upload — Upload a PDF, store in OSS.
 *
 * Accepts multipart/form-data with:
 *   - file: PDF file
 *   - projectId: project ID
 *   - paperId: (optional) existing paper ID to attach fullText to
 *   - fullText: (optional) pre-extracted text from client-side pdf.js
 *   - title: (optional) pre-extracted title
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string | null;
    const paperId = formData.get("paperId") as string | null;
    let fullText = (formData.get("fullText") as string | null) ?? "";
    const clientTitle = formData.get("title") as string | null;

    if (!file || !projectId) {
      return NextResponse.json(
        { error: "file and projectId required" },
        { status: 400 }
      );
    }

    const auth = await requireProjectAccess(projectId);
    if (auth instanceof NextResponse) return auth;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF files are supported" },
        { status: 400 }
      );
    }

    // Read PDF buffer
    const arrayBuffer = await file.arrayBuffer();
    const pdfBytes = Buffer.from(arrayBuffer);

    // Strip null bytes — PostgreSQL TEXT rejects \x00
    if (fullText) fullText = fullText.replace(/\x00/g, "");

    // If client didn't send fullText, try server-side extraction as fallback
    if (!fullText || fullText.trim().length < 50) {
      try {
        const { extractText } = await import("unpdf");
        const buffer = new Uint8Array(pdfBytes);
        const result = await extractText(buffer, { mergePages: true });
        fullText = (result.text ?? "").replace(/\x00/g, "");
      } catch {
        // unpdf not available or failed — continue without fullText
      }
    }

    if (!fullText || fullText.trim().length < 50) {
      return NextResponse.json(
        { error: "文本过少，可能是扫描版 PDF 或加密文档。请确保 PDF 包含可复制的文本。" },
        { status: 422 }
      );
    }

    // Try to extract abstract from the full text
    const abstractMatch = fullText.match(
      /(?:abstract|摘\s*要)[:\s]*\n?([\s\S]{100,2000}?)(?:\n\s*(?:keywords|key\s*words|introduction|1[\s.]|关键词|引言))/i
    );
    const extractedAbstract = abstractMatch?.[1]?.trim();

    if (paperId) {
      // Upload PDF to OSS
      const key = pdfKey(projectId, paperId, file.name);
      const ossKey = await uploadPdf(key, pdfBytes);

      // Attach fullText + OSS key to existing paper
      const paper = await prisma.paper.update({
        where: { id: paperId },
        data: {
          fullText: fullText.trim(),
          pdfFileName: file.name,
          pdfOssKey: ossKey,
          ...(ossKey ? { pdfData: null } : { pdfData: pdfBytes }),
        },
      });

      return NextResponse.json({
        paper,
        textLength: fullText.length,
        wordCount: fullText.split(/\s+/).length,
      });
    }

    // Create new paper
    const title = clientTitle || file.name.replace(/\.pdf$/i, "");

    const paper = await prisma.paper.create({
      data: {
        projectId,
        title,
        abstract: extractedAbstract ?? fullText.slice(0, 500),
        authors: [],
        source: "manual",
        citationCount: 0,
        referenceCount: 0,
        fullText: fullText.trim(),
        pdfFileName: file.name,
      },
    });

    // Upload PDF to OSS
    const key = pdfKey(projectId, paper.id, file.name);
    const ossKey = await uploadPdf(key, pdfBytes);

    // Update paper with OSS key (or fallback to pdfData)
    await prisma.paper.update({
      where: { id: paper.id },
      data: ossKey
        ? { pdfOssKey: ossKey }
        : { pdfData: pdfBytes },
    });

    return NextResponse.json({
      paper: { ...paper, pdfOssKey: ossKey },
      textLength: fullText.length,
      wordCount: fullText.split(/\s+/).length,
    });
  } catch (error) {
    console.error("[upload] PDF processing error:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    let userMessage = "PDF 处理失败";

    if (errMsg.includes("decrypt") || errMsg.includes("password") || errMsg.includes("encrypted")) {
      userMessage = "PDF 已加密，无法解析。请上传未加密的版本";
    } else if (errMsg.includes("ENOMEM") || errMsg.includes("heap")) {
      userMessage = "文件过大，服务器内存不足。请尝试压缩 PDF 后重新上传";
    } else if (errMsg.includes("timeout") || errMsg.includes("ETIMEDOUT")) {
      userMessage = "上传超时，请检查网络后重试";
    } else if (errMsg.includes("Invalid PDF") || errMsg.includes("not a PDF")) {
      userMessage = "无效的 PDF 文件，请检查文件是否损坏";
    }

    return NextResponse.json(
      { error: userMessage, details: errMsg.slice(0, 200) },
      { status: 500 }
    );
  }
}

export const maxDuration = 120;
