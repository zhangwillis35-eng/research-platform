/**
 * Fetch with exponential backoff retry for rate-limited APIs.
 *
 * Retries on 429 (Too Many Requests) and 503 (Service Unavailable).
 * Uses exponential backoff with jitter to avoid thundering herd.
 * Includes per-request timeout to prevent hanging connections.
 */
import { proxyFetch } from "@/lib/ai/proxy-fetch";

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: number[];
  /** Per-request timeout in ms (default: 15000) */
  timeoutMs?: number;
}

const DEFAULT_RETRY_ON = [429, 503];

export async function fetchWithRetry(
  url: string,
  init?: RequestInit & { body?: string },
  options?: RetryOptions
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelay = options?.baseDelayMs ?? 1000;
  const maxDelay = options?.maxDelayMs ?? 10000;
  const retryOn = options?.retryOn ?? DEFAULT_RETRY_ON;
  const timeoutMs = options?.timeoutMs ?? 15000;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Add timeout signal — prevents hanging on unresponsive APIs
      const signal = AbortSignal.timeout(timeoutMs);
      const mergedInit = init ? { ...init, signal } : { signal };

      const res = await proxyFetch(url, mergedInit as RequestInit & { body?: string });

      if (!retryOn.includes(res.status) || attempt === maxRetries) {
        return res;
      }

      // Parse Retry-After header if present
      const retryAfter = res.headers.get("Retry-After");
      let delayMs: number;

      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        delayMs = isNaN(seconds) ? baseDelay : seconds * 1000;
      } else {
        // Exponential backoff with jitter
        delayMs = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        delayMs += Math.random() * delayMs * 0.3; // 30% jitter
      }

      console.log(
        `[retry-fetch] ${res.status} on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${Math.round(delayMs)}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries) break;

      const delayMs = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      console.log(
        `[retry-fetch] Network error on attempt ${attempt + 1}/${maxRetries + 1}: ${lastError.message}, retrying in ${Math.round(delayMs)}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError ?? new Error("fetchWithRetry: max retries exceeded");
}
