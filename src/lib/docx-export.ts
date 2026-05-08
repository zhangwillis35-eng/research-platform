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
  ImageRun,
} from "docx";
import type { AcademicTerm, PaperAnalysis } from "./research/paper-translator";

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

// ─── Translation document export ──────────────────────────────────────────────

export interface FigureImage {
  label: string;       // "图1" / "表2"
  caption: string;     // Translated caption
  imageData?: Uint8Array; // PNG bytes (optional — placeholder if absent)
  width?: number;
  height?: number;
}

function makeSeparator(): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: "─".repeat(40), color: "CCCCCC", font: EN_FONT, size: 18 })],
    spacing: { before: 200, after: 200 },
  });
}

function makeInfoBlock(label: string, value: string): Paragraph[] {
  return [
    new Paragraph({
      children: [
        new TextRun({ text: label, font: CN_FONT, size: BODY_SIZE, bold: true, color: "444444" }),
        new TextRun({ text: value, font: CN_FONT, size: BODY_SIZE }),
      ],
      spacing: { after: 100 },
    }),
  ];
}

export async function generateTranslationDocx(options: {
  originalTitle: string;
  translatedTitle: string;
  authors?: string;
  year?: number;
  venue?: string;
  translatedText: string;
  terms?: AcademicTerm[];
  analysis?: PaperAnalysis | null;
  figures?: FigureImage[];
}): Promise<Blob> {
  const {
    originalTitle,
    translatedTitle,
    authors,
    year,
    venue,
    translatedText,
    terms = [],
    analysis,
    figures = [],
  } = options;

  const allChildren: Paragraph[] = [];

  // ── Cover ──────────────────────────────────────────────────────────────
  allChildren.push(
    new Paragraph({
      children: splitByLanguage(translatedTitle, H1_SIZE, true),
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );
  allChildren.push(
    new Paragraph({
      children: splitByLanguage(originalTitle, BODY_SIZE, false),
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    })
  );
  if (authors) {
    allChildren.push(
      new Paragraph({
        children: [new TextRun({ text: authors, font: EN_FONT, size: 20, color: "555555" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      })
    );
  }
  if (venue || year) {
    allChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: [venue, year].filter(Boolean).join(", "),
            font: EN_FONT,
            size: 20,
            color: "777777",
            italics: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );
  }
  allChildren.push(makeSeparator());

  // ── Translated body ────────────────────────────────────────────────────
  allChildren.push(
    new Paragraph({
      children: splitByLanguage("一、论文译文", H2_SIZE, true),
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 200 },
    })
  );

  const lines = translatedText.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      allChildren.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }
    if (/^#{1,3}\s/.test(trimmed) || /^\d{1,2}\.?\s/.test(trimmed) && trimmed.length < 80) {
      const level = trimmed.startsWith("###") ? H3_SIZE : H2_SIZE;
      const text = trimmed.replace(/^#+\s*/, "");
      allChildren.push(
        new Paragraph({
          children: splitByLanguage(text, level, true),
          heading: level === H2_SIZE ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (/^\[图|^\[表/.test(trimmed)) {
      // Figure/table placeholder — style differently
      allChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: trimmed, font: CN_FONT, size: BODY_SIZE, italics: true, color: "666666" }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 160 },
        })
      );
    } else {
      allChildren.push(
        new Paragraph({
          children: splitByLanguage(trimmed, BODY_SIZE),
          spacing: { line: 360, after: 80 },
          indent: { firstLine: 480 },
        })
      );
    }
  }

  // ── Figures / images ───────────────────────────────────────────────────
  if (figures.length > 0) {
    allChildren.push(makeSeparator());
    allChildren.push(
      new Paragraph({
        children: splitByLanguage("二、图表", H2_SIZE, true),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 200 },
      })
    );

    for (const fig of figures) {
      allChildren.push(
        new Paragraph({
          children: splitByLanguage(fig.label, H3_SIZE, true),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        })
      );
      if (fig.imageData) {
        allChildren.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: fig.imageData,
                transformation: {
                  width: fig.width ?? 500,
                  height: fig.height ?? 300,
                },
                type: "png",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          })
        );
      } else {
        allChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[${fig.label}：图片提取失败，请参见原始PDF]`,
                font: CN_FONT,
                size: BODY_SIZE,
                italics: true,
                color: "888888",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          })
        );
      }
      if (fig.caption) {
        allChildren.push(
          new Paragraph({
            children: splitByLanguage(fig.caption, 20),
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          })
        );
      }
    }
  }

  // ── Terms ──────────────────────────────────────────────────────────────
  if (terms.length > 0) {
    allChildren.push(makeSeparator());
    allChildren.push(
      new Paragraph({
        children: splitByLanguage("三、关键术语对照表", H2_SIZE, true),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 200 },
      })
    );

    allChildren.push(
      new Paragraph({
        children: [
          new TextRun({ text: "英文术语", font: CN_FONT, size: BODY_SIZE, bold: true }),
          new TextRun({ text: "\t→\t", font: EN_FONT, size: BODY_SIZE }),
          new TextRun({ text: "中文翻译（类别 | 核验）", font: CN_FONT, size: BODY_SIZE, bold: true }),
        ],
        spacing: { after: 100 },
      })
    );
    for (const t of terms) {
      const displayZh = t.correction ?? t.zh;
      const catMap: Record<string, string> = { theory: "理论", method: "方法", concept: "概念", other: "其他" };
      allChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: t.en, font: EN_FONT, size: BODY_SIZE }),
            new TextRun({ text: "  →  ", font: EN_FONT, size: BODY_SIZE, color: "888888" }),
            new TextRun({ text: displayZh, font: CN_FONT, size: BODY_SIZE, bold: !t.isAccurate }),
            new TextRun({
              text: `  [${catMap[t.category] ?? "其他"}]  ${t.isAccurate ? "✓" : "⚡已修正"}`,
              font: CN_FONT,
              size: 20,
              color: t.isAccurate ? "22C55E" : "EF4444",
            }),
          ],
          spacing: { after: 80 },
          indent: { firstLine: 0 },
        })
      );
    }
    // Suppress unused variables from table attempt
  }

  // ── Analysis ───────────────────────────────────────────────────────────
  if (analysis) {
    allChildren.push(makeSeparator());
    allChildren.push(
      new Paragraph({
        children: splitByLanguage("四、论文分析", H2_SIZE, true),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 200 },
      })
    );

    const sections: [string, string][] = [
      ["研究概要", analysis.summary],
      ["研究方法", analysis.methods],
      ["学术贡献", analysis.contributions],
      ["创新点", analysis.innovations],
    ];

    for (const [label, content] of sections) {
      allChildren.push(
        new Paragraph({
          children: splitByLanguage(label, H3_SIZE, true),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
        })
      );
      for (const para of content.split("\n").filter((l) => l.trim())) {
        allChildren.push(
          new Paragraph({
            children: splitByLanguage(para.trim(), BODY_SIZE),
            spacing: { line: 360, after: 80 },
            indent: { firstLine: 480 },
          })
        );
      }
    }
  }

  const doc = new Document({
    sections: [{ children: allChildren }],
  });

  return await Packer.toBlob(doc);
}
