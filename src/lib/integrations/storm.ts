/**
 * Stanford STORM integration — built-in literature review & analysis engine.
 *
 * Uses the knowledge-storm Python library via subprocess.
 * No external service required — runs locally with DeepSeek API.
 *
 * Two modes:
 * - simple: Uses litellm directly for fast structured review (default)
 * - full: Uses full STORM pipeline with multi-perspective research (slower, deeper)
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { getEnv } from "@/lib/env";

const BRIDGE_PATH = resolve(process.cwd(), "scripts/storm-bridge.py");

export interface StormPaper {
  title: string;
  abstract?: string;
  authors?: string;
  year?: number;
  venue?: string;
  fullText?: string;
}

export interface StormResult {
  article: string;
  outline: string;
  status: "success" | "error";
  error?: string;
  mode?: string;
}

/**
 * Check if STORM is available (Python + knowledge-storm installed).
 */
function runPython(args: string[], input?: string, timeout = 300000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", args, {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.slice(0, 500) || `exit code ${code}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", reject);

    if (input) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}

export async function checkStormAvailable(): Promise<{
  available: boolean;
  error?: string;
}> {
  try {
    await runPython(["-c", "import knowledge_storm; import litellm; print('ok')"], undefined, 10000);
    return { available: true };
  } catch {
    return {
      available: false,
      error: "Stanford STORM 未安装。运行: pip3 install knowledge-storm",
    };
  }
}

/**
 * Run STORM analysis on a set of papers.
 */
export type StormMode = "review" | "variables" | "theories" | "gaps";

export async function runStormAnalysis(
  topic: string,
  papers: StormPaper[],
  options?: {
    mode?: StormMode;
    fullStorm?: boolean;
  }
): Promise<StormResult> {
  const apiKey = getEnv("DEEPSEEK_API_KEY");
  const serperKey = getEnv("SERPER_API_KEY");

  if (!apiKey) {
    return { article: "", outline: "", status: "error", error: "DEEPSEEK_API_KEY not set" };
  }

  const input = JSON.stringify({
    topic,
    papers: papers.map((p) => ({
      title: p.title,
      abstract: p.abstract ?? "",
      authors: p.authors ?? "",
      year: p.year,
      venue: p.venue ?? "",
      fullText: p.fullText ?? "",
    })),
    mode: options?.mode ?? "review",
    api_key: apiKey,
  });

  try {
    const stdout = await runPython([BRIDGE_PATH], input);
    const result = JSON.parse(stdout) as StormResult;
    return result;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[storm] execution failed:", errMsg);
    return {
      article: "",
      outline: "",
      status: "error",
      error: errMsg.slice(0, 300),
    };
  }
}
