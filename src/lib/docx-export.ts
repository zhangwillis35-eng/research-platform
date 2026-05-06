/**
 * Client-side Word document generation.
 * Chinese → 宋体, English/numbers → Times New Roman.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";

const CN_FONT = "宋体";
const EN_FONT = "Times New Roman";
const BODY_SIZE = 24; // 12pt in half-points
const H1_SIZE = 32;   // 16pt
const H2_SIZE = 28;   // 14pt
const H3_SIZE = 26;   // 13pt

function isChinese(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef);
}

function splitByLanguage(text: string, size: number, bold = false): TextRun[] {
  if (!text) return [];
  const segments = text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+|[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g) ?? [text];
  return segments.map(seg => {
    const cn = /[\u4e00-\u9fff]/.test(seg);
    return new TextRun({
      text: seg,
      font: cn ? CN_FONT : EN_FONT,
      size,
      bold,
    });
  });
}

export async function generateReviewDocx(title: string, reviewText: string): Promise<Blob> {
  const children: Paragraph[] = [];

  // Title
  children.push(new Paragraph({
    children: splitByLanguage(title, H1_SIZE, true),
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }));

  const lines = reviewText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      children.push(new Paragraph({ spacing: { after: 100 } }));
      continue;
    }

    if (trimmed.startsWith("## ")) {
      children.push(new Paragraph({
        children: splitByLanguage(trimmed.slice(3), H2_SIZE, true),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 },
      }));
    } else if (trimmed.startsWith("### ")) {
      children.push(new Paragraph({
        children: splitByLanguage(trimmed.slice(4), H3_SIZE, true),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 },
      }));
    } else if (trimmed.startsWith("# ")) {
      children.push(new Paragraph({
        children: splitByLanguage(trimmed.slice(2), H1_SIZE, true),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }));
    } else {
      // Body text
      const isRefLine = /^\[?\d+\]?\s/.test(trimmed) || /^[A-Z][a-z]+,?\s/.test(trimmed);
      children.push(new Paragraph({
        children: splitByLanguage(trimmed, BODY_SIZE),
        spacing: { line: 360 }, // 1.5x line spacing
        indent: isRefLine ? undefined : { firstLine: 480 }, // 2-char indent for body, no indent for references
      }));
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return await Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
