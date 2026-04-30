/**
 * Aliyun OSS service for PDF storage.
 *
 * Required env vars:
 *   OSS_ACCESS_KEY_ID
 *   OSS_ACCESS_KEY_SECRET
 *   OSS_BUCKET        — e.g. "scholarflow-pdfs"
 *   OSS_REGION         — e.g. "oss-cn-hongkong"
 */

import OSS from "ali-oss";

let cachedClient: OSS | null = null;

function getClient(): OSS | null {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;
  const region = process.env.OSS_REGION;

  if (!accessKeyId || !accessKeySecret || !bucket || !region) return null;

  if (!cachedClient) {
    cachedClient = new OSS({
      accessKeyId,
      accessKeySecret,
      bucket,
      region,
    });
  }
  return cachedClient;
}

/** Build the OSS key for a paper's PDF */
export function pdfKey(projectId: string, paperId: string, fileName: string): string {
  return `papers/${projectId}/${paperId}/${fileName}`;
}

/** Upload a PDF buffer to OSS. Returns the key on success, null on failure. */
export async function uploadPdf(
  key: string,
  data: Buffer
): Promise<string | null> {
  const client = getClient();
  if (!client) {
    console.warn("[OSS] Not configured, skipping upload");
    return null;
  }

  try {
    await client.put(key, data, {
      headers: { "Content-Type": "application/pdf" },
    });
    return key;
  } catch (err) {
    console.error("[OSS] Upload failed:", err);
    return null;
  }
}

/** Generate a signed URL for reading a PDF (valid for 1 hour). */
export function getSignedUrl(key: string, expiresSeconds = 3600): string | null {
  const client = getClient();
  if (!client) return null;

  try {
    return client.signatureUrl(key, { expires: expiresSeconds });
  } catch (err) {
    console.error("[OSS] SignedUrl failed:", err);
    return null;
  }
}

/** Delete a PDF from OSS. */
export async function deletePdf(key: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  try {
    await client.delete(key);
    return true;
  } catch (err) {
    console.error("[OSS] Delete failed:", err);
    return false;
  }
}
