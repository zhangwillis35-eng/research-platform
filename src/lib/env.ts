/**
 * Explicit .env loader — forces .env values to override shell environment.
 *
 * Problem: Claude Code injects its own GEMINI_API_KEY into the shell,
 * which overrides the user's .env file. Next.js respects existing env vars
 * over .env, so the wrong key gets used.
 *
 * Solution: Read .env file directly and parse it ourselves.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

let envCache: Record<string, string> | null = null;

function loadEnvFile(): Record<string, string> {
  if (envCache) return envCache;

  const result: Record<string, string> = {};

  try {
    const envPath = resolve(process.cwd(), ".env");
    const content = readFileSync(envPath, "utf-8");

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=["']?(.+?)["']?$/);
      if (match) {
        result[match[1]] = match[2];
      }
    }
  } catch (err) {
    console.error("[env] Failed to read .env file:", (err as Error).message);
  }

  console.log(`[env] Loaded ${Object.keys(result).length} vars from .env file`);
  envCache = result;
  return result;
}

/**
 * Get an environment variable, with .env file taking priority over shell env.
 * This is the OPPOSITE of Next.js default behavior, but necessary when
 * the shell has stale/wrong values injected by other tools.
 */
export function getEnv(key: string): string | undefined {
  const fileVars = loadEnvFile();
  const fromFile = fileVars[key];
  const fromEnv = process.env[key];

  if (key.includes("API_KEY") || key.includes("GEMINI")) {
    const filePrefix = fromFile ? fromFile.slice(0, 12) + "..." : "NONE";
    const envPrefix = fromEnv ? fromEnv.slice(0, 12) + "..." : "NONE";
    if (fromFile && fromEnv && fromFile !== fromEnv) {
      console.log(`[env] ${key}: .env="${filePrefix}" vs shell="${envPrefix}" → using .env`);
    }
  }

  return fromFile ?? fromEnv;
}
