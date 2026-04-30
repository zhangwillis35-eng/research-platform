import { prisma } from "./db";

interface TokenLogEntry {
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  endpoint?: string;
}

const buffer: TokenLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await prisma.tokenUsage.createMany({ data: batch });
  } catch (e) {
    console.error("[token-logger] flush failed:", e);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 3000);
}

/**
 * Log LLM token usage. Buffered and flushed in batches.
 */
export function logTokenUsage(entry: TokenLogEntry) {
  buffer.push(entry);
  if (buffer.length >= 20) {
    flush();
  } else {
    scheduleFlush();
  }
}
