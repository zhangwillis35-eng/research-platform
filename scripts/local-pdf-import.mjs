#!/usr/bin/env node
/**
 * Local PDF batch import — extract text on Mac, send only text to server.
 *
 * Usage:
 *   node scripts/local-pdf-import.mjs <folder-path> <project-id> [server-url]
 *
 * This is 10-50x faster than uploading PDFs through the web UI because:
 *   - Text extraction runs locally (~150ms per file)
 *   - Only sends ~50KB of text per file instead of 1-5MB PDF binary
 */

import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { extractText } from "unpdf";

const [, , folderPath, projectId, serverUrl = "https://103.38.80.155"] = process.argv;

if (!folderPath || !projectId) {
  console.log("Usage: node scripts/local-pdf-import.mjs <folder-path> <project-id> [server-url]");
  console.log("Example: node scripts/local-pdf-import.mjs ~/Desktop/papers cmo4bhajc000004jmadv3jzgq");
  process.exit(1);
}

// Read .env for user_id
let userId = "default-user";
try {
  const env = readFileSync(join(import.meta.dirname, "../.env"), "utf8");
  const match = env.match(/DEFAULT_USER_ID=(.+)/);
  if (match) userId = match[1].trim();
} catch {}

const files = readdirSync(folderPath).filter((f) => f.toLowerCase().endsWith(".pdf"));
console.log(`Found ${files.length} PDFs in ${folderPath}`);
console.log(`Project: ${projectId}`);
console.log(`Server: ${serverUrl}`);
console.log(`User: ${userId}\n`);

let succeeded = 0;
let matched = 0;
let created = 0;
let failed = 0;
const CONCURRENCY = 5;

async function processOne(fileName) {
  const filePath = join(folderPath, fileName);
  const t0 = Date.now();

  // Step 1: Extract text locally
  let fullText;
  try {
    const buf = readFileSync(filePath);
    const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const { text } = await extractText(uint8, { mergePages: true });
    fullText = text?.trim();
  } catch (err) {
    console.log(`  ✗ ${fileName} — extract failed: ${err.message}`);
    failed++;
    return;
  }

  if (!fullText || fullText.length < 100) {
    console.log(`  ✗ ${fileName} — too little text (${fullText?.length ?? 0} chars)`);
    failed++;
    return;
  }

  const extractMs = Date.now() - t0;

  // Step 2: Extract metadata locally
  const title = extractTitle(fullText, fileName);
  const abstract = extractAbstract(fullText);

  // Step 3: Send only text to server (no PDF binary)
  const t1 = Date.now();
  try {
    const res = await fetch(`${serverUrl}/api/papers/batch-upload-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `user_id=${userId}`,
      },
      body: JSON.stringify({
        projectId,
        title,
        abstract: abstract ?? fullText.slice(0, 500),
        fullText: fullText.slice(0, 30000),
        pdfFileName: fileName,
        authors: [],
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json();
    const uploadMs = Date.now() - t1;
    const totalMs = Date.now() - t0;

    if (res.ok) {
      succeeded++;
      if (data.matched) matched++;
      else created++;
      console.log(`  ✓ ${fileName} — ${title.slice(0, 50)}  [extract:${extractMs}ms upload:${uploadMs}ms total:${totalMs}ms]${data.matched ? " (matched)" : ""}`);
    } else {
      failed++;
      console.log(`  ✗ ${fileName} — ${data.error ?? res.status}`);
    }
  } catch (err) {
    failed++;
    console.log(`  ✗ ${fileName} — upload failed: ${err.message}`);
  }
}

function extractTitle(text, fileName) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const hasLineBreaks = lines.length > 5;

  if (hasLineBreaks) {
    for (const line of lines.slice(0, 20)) {
      if (line.length >= 15 && line.length <= 250 && !/^[\d\s.]+$/.test(line) && !line.startsWith("http")) {
        return line;
      }
    }
  } else {
    const beforeAbstract = text.match(/^(.*?)(?:\s*Abstract[\s—:.-])/i);
    if (beforeAbstract) {
      let candidate = beforeAbstract[1]
        .replace(/arXiv:\S+\s*/g, "")
        .replace(/\[[\w.]+\]\s*/g, "")
        .replace(/\d{1,2}\s+\w+\s+\d{4}\s*/g, "")
        .trim();
      const authorStart = candidate.search(/\s[A-Z][a-z]+\s+[A-Z][a-z]+\s*[\*†‡\d]/);
      if (authorStart > 10) candidate = candidate.slice(0, authorStart).trim();
      if (candidate.length >= 10 && candidate.length <= 300) return candidate;
    }
  }
  return fileName.replace(/\.pdf$/i, "");
}

function extractAbstract(text) {
  const match = text.match(
    /(?:abstract|摘\s*要)[\s—:.-]*([\s\S]{80,3000}?)(?:\b(?:keywords?|key\s*words?|introduction|1[\s.。]|关键词|引言)\b|\n\n\n)/i
  );
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

// Run with sliding window concurrency
const queue = [...files];
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length > 0) {
    await processOne(queue.shift());
  }
});
await Promise.all(workers);

console.log(`\n=== Done ===`);
console.log(`Succeeded: ${succeeded} (matched: ${matched}, created: ${created})`);
console.log(`Failed: ${failed}`);
