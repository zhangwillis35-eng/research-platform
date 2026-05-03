/**
 * NotebookLM integration — wraps the Python notebooklm-bridge.py subprocess.
 *
 * Pattern follows src/lib/integrations/storm.ts
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const BRIDGE_PATH = resolve(process.cwd(), "scripts/notebooklm-bridge.py");

interface BridgeResult {
  status: "success" | "error";
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function runBridge(input: Record<string, unknown>, timeout = 120000): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [BRIDGE_PATH], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.slice(0, 500) || `exit code ${code}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Invalid JSON from bridge: ${stdout.slice(0, 200)}`));
        }
      }
    });

    proc.on("error", reject);

    if (proc.stdin.writable) {
      proc.stdin.write(JSON.stringify(input));
      proc.stdin.end();
    }
  });
}

/**
 * Check if NotebookLM is available and authenticated.
 */
export async function checkNotebookLM(): Promise<{
  available: boolean;
  authenticated: boolean;
  notebookCount?: number;
  error?: string;
}> {
  try {
    const result = await runBridge({ command: "check" });
    return {
      available: result.available ?? false,
      authenticated: result.authenticated ?? false,
      notebookCount: result.notebook_count,
      error: result.error,
    };
  } catch (err) {
    return {
      available: false,
      authenticated: false,
      error: String(err),
    };
  }
}

/**
 * Batch import URLs to a NotebookLM notebook.
 */
export async function batchImportToNotebookLM(
  notebookUrl: string,
  urls: string[]
): Promise<{
  imported: number;
  failed: number;
  total: number;
  details?: Array<{ url: string; status: string; error?: string }>;
}> {
  const result = await runBridge(
    { command: "batch-import", notebook_url: notebookUrl, urls },
    300000 // 5 min timeout for large batches
  );

  if (result.status === "error") {
    throw new Error(result.error ?? "Batch import failed");
  }

  return {
    imported: result.imported ?? 0,
    failed: result.failed ?? 0,
    total: result.total ?? urls.length,
    details: result.details,
  };
}

/**
 * Ask a question to the NotebookLM notebook.
 */
export async function askNotebookLM(
  notebookUrl: string,
  question: string,
  sessionId?: string
): Promise<{
  answer: string;
  sessionId?: string;
}> {
  const result = await runBridge({
    command: "ask",
    notebook_url: notebookUrl,
    question,
    session_id: sessionId,
  });

  if (result.status === "error") {
    throw new Error(result.error ?? "NotebookLM query failed");
  }

  return {
    answer: result.answer ?? "",
    sessionId: result.session_id,
  };
}

/**
 * List available NotebookLM notebooks.
 */
export async function listNotebookLMNotebooks(): Promise<
  Array<{ id: string; title: string }>
> {
  const result = await runBridge({ command: "list-notebooks" });
  if (result.status === "error") {
    throw new Error(result.error ?? "Failed to list notebooks");
  }
  return result.notebooks ?? [];
}
