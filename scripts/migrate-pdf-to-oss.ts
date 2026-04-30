/**
 * One-time migration: move pdfData from Neon PostgreSQL to Aliyun OSS.
 *
 * Usage: npx tsx -r dotenv/config scripts/migrate-pdf-to-oss.ts
 */

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import OSS from "ali-oss";

function pdfKey(projectId: string, paperId: string, fileName: string): string {
  return `papers/${projectId}/${paperId}/${fileName}`;
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ossClient = new OSS({
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    region: process.env.OSS_REGION!,
  });

  // Find all papers that have pdfData but no pdfOssKey
  const papers = await prisma.paper.findMany({
    where: {
      pdfData: { not: null },
      pdfOssKey: null,
    },
    select: {
      id: true,
      projectId: true,
      pdfFileName: true,
      pdfData: true,
    },
  });

  console.log(`Found ${papers.length} papers with pdfData to migrate.\n`);

  let success = 0;
  let failed = 0;

  for (const paper of papers) {
    if (!paper.pdfData) continue;

    const fileName = paper.pdfFileName || `${paper.id}.pdf`;
    const key = pdfKey(paper.projectId, paper.id, fileName);

    console.log(`  Uploading ${fileName} (${(paper.pdfData.length / 1024).toFixed(0)} KB) ...`);

    try {
      await ossClient.put(key, Buffer.from(paper.pdfData), {
        headers: { "Content-Type": "application/pdf" },
      });

      await prisma.paper.update({
        where: { id: paper.id },
        data: { pdfOssKey: key, pdfData: null },
      });

      success++;
      console.log(`  ✓ Migrated: ${key}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ Failed: ${fileName}`, err);
    }
  }

  console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
