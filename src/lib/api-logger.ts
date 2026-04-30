import { prisma } from "./db";

interface LogEntry {
  userId: string | null;
  method: string;
  path: string;
  status: number;
  duration: number;
}

const buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const FLUSH_INTERVAL = 5000; // 5s
const FLUSH_SIZE = 50;

async function flush() {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await prisma.apiLog.createMany({ data: batch });
  } catch (e) {
    console.error("[api-logger] flush failed:", e);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL);
}

/**
 * Log an API request. Buffered and flushed in batches.
 */
export function logApiRequest(entry: LogEntry) {
  buffer.push(entry);
  if (buffer.length >= FLUSH_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}
