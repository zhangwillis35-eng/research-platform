/**
 * Proxy-aware fetch using undici ProxyAgent.
 *
 * node-fetch + https-proxy-agent breaks in Next.js Turbopack.
 * undici is Node.js native and works reliably in all environments.
 */
import { ProxyAgent, fetch as undiciFetch } from "undici";

let cachedDispatcher: ProxyAgent | null = null;

/** Combine an optional caller signal with a timeout. Used to cap streaming LLM calls. */
export function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function getDispatcher(): ProxyAgent | undefined {
  const proxy =
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY;

  if (!proxy) return undefined;

  if (!cachedDispatcher) {
    cachedDispatcher = new ProxyAgent(proxy);
  }
  return cachedDispatcher;
}

export async function proxyFetch(
  url: string,
  init?: RequestInit & { body?: string }
): Promise<Response> {
  const dispatcher = getDispatcher();

  if (dispatcher) {
    try {
      const res = await undiciFetch(url, {
        ...init,
        dispatcher,
      } as Parameters<typeof undiciFetch>[1]);
      return res as unknown as Response;
    } catch (err) {
      console.error(
        "[proxy-fetch] Proxy failed, trying direct:",
        (err as Error).message
      );
    }
  }

  return globalThis.fetch(url, init);
}
