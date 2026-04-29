/**
 * Institutional proxy support for accessing paywalled papers.
 *
 * Chinese universities typically use EZproxy which rewrites URLs:
 *   https://doi.org/10.1126/science.xxx
 *   → https://doi-org.ezproxy.sysu.edu.cn/10.1126/science.xxx
 *
 * This module:
 * 1. Converts DOI/publisher URLs to proxied URLs
 * 2. Fetches full text through the institutional proxy
 * 3. Requires user to be logged in to their university VPN/proxy
 *
 * Supported proxy types:
 * - EZproxy (中山大学, 北大, 清华, etc.)
 * - CARSI (中国教育科研网联邦认证)
 */

export interface InstitutionalConfig {
  enabled: boolean;
  proxyType: "ezproxy" | "carsi" | "custom";
  proxyBase: string; // e.g., "ezproxy.sysu.edu.cn"
  cookie?: string;   // session cookie from browser after login
}

// ─── Known university proxy configurations ──────

export const KNOWN_PROXIES: Record<string, {
  name: string;
  proxyBase: string;
  proxyType: "ezproxy" | "carsi" | "webvpn" | "ip";
  vpnUrl?: string; // VPN login page
  note?: string;
}> = {
  // ── 直连校园网即可（IP 认证）──
  // 这些学校在校园网内通过 IP 直接认证，不需要 EZproxy
  // 只要 VPN/代理软件将出版商域名设为直连即可
  sysu: {
    name: "中山大学",
    proxyBase: "sysu.edu.cn",
    proxyType: "ip",
    vpnUrl: "https://vpn.sysu.edu.cn",
    note: "校园网 IP 直接认证；校外需连 EasyConnect VPN (vpn.sysu.edu.cn)",
  },
  tsinghua: {
    name: "清华大学",
    proxyBase: "tsinghua.edu.cn",
    proxyType: "ip",
    vpnUrl: "https://sslvpn.tsinghua.edu.cn",
    note: "校园网 IP 直接认证；校外用 Pulse Secure VPN (sslvpn.tsinghua.edu.cn) 或 CARSI",
  },
  pku: {
    name: "北京大学",
    proxyBase: "pku.edu.cn",
    proxyType: "ip",
    vpnUrl: "https://vpn.pku.edu.cn",
    note: "校园网 IP 直接认证；校外用 WebVPN (vpn.pku.edu.cn) 或 CARSI",
  },
  sjtu: {
    name: "上海交通大学",
    proxyBase: "sjtu.edu.cn",
    proxyType: "ip",
    vpnUrl: "https://vpn.sjtu.edu.cn",
    note: "校园网 IP 直接认证；校外用 EasyConnect VPN 或 CARSI 联邦认证",
  },
  fudan: {
    name: "复旦大学",
    proxyBase: "fudan.edu.cn",
    proxyType: "ip",
    vpnUrl: "https://vpn.fudan.edu.cn",
    note: "校园网 IP 直接认证；校外用 WebVPN (vpn.fudan.edu.cn) 或 CARSI",
  },
  zju: {
    name: "浙江大学",
    proxyBase: "zju.edu.cn",
    proxyType: "ip",
    vpnUrl: "https://rvpn.zju.edu.cn",
    note: "校园网 IP 直接认证；校外用 RVPN 或 CARSI",
  },
  nju: {
    name: "南京大学",
    proxyBase: "nju.edu.cn",
    proxyType: "ip",
    vpnUrl: "https://vpn.nju.edu.cn",
    note: "校园网 IP 直接认证；校外用 VPN 或 CARSI",
  },
  whu: {
    name: "武汉大学",
    proxyBase: "whu.edu.cn",
    proxyType: "ip",
    vpnUrl: "https://vpn.whu.edu.cn",
    note: "校园网 IP 直接认证；校外用 VPN 或 CARSI",
  },
  ruc: {
    name: "中国人民大学",
    proxyBase: "ruc.edu.cn",
    proxyType: "ip",
    vpnUrl: "https://vpn.ruc.edu.cn",
    note: "校园网 IP 直接认证；校外用 VPN 或 CARSI",
  },
  xmu: {
    name: "厦门大学",
    proxyBase: "xmu.edu.cn",
    proxyType: "ip",
    vpnUrl: "https://vpn.xmu.edu.cn",
    note: "校园网 IP 直接认证；校外用 VPN 或 CARSI",
  },
};

// ─── URL conversion ─────────────────────────────

/**
 * Convert a DOI to an EZproxy URL.
 * https://doi.org/10.1126/science.xxx
 * → https://doi-org.ezproxy.sysu.edu.cn/10.1126/science.xxx
 */
export function doiToProxyUrl(doi: string, config: InstitutionalConfig): string {
  if (config.proxyType === "ezproxy") {
    return `https://doi-org.${config.proxyBase}/${doi}`;
  }
  // Fallback: append proxy parameter
  return `https://doi.org/${doi}?ezproxy=${config.proxyBase}`;
}

/**
 * Convert any publisher URL to proxied version.
 * https://www.sciencedirect.com/science/article/pii/xxx
 * → https://www-sciencedirect-com.ezproxy.sysu.edu.cn/science/article/pii/xxx
 */
export function urlToProxyUrl(url: string, config: InstitutionalConfig): string {
  if (config.proxyType === "ezproxy") {
    try {
      const parsed = new URL(url);
      const proxiedHost = parsed.hostname.replace(/\./g, "-") + "." + config.proxyBase;
      return `${parsed.protocol}//${proxiedHost}${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  }
  return url;
}

/**
 * Try to fetch full text through institutional proxy.
 * Requires the user to be logged in (cookie-based auth).
 */
export async function fetchViaProxy(
  doi: string,
  config: InstitutionalConfig
): Promise<string | null> {
  if (!config.enabled || !config.proxyBase) return null;

  const proxyUrl = doiToProxyUrl(doi, config);

  try {
    const headers: HeadersInit = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    };
    if (config.cookie) {
      headers["Cookie"] = config.cookie;
    }

    const res = await fetch(proxyUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const html = await res.text();

    // Check if we got a login page instead of the paper
    if (html.includes("login") && html.includes("password") && html.length < 5000) {
      return null; // Not authenticated
    }

    return html;
  } catch {
    return null;
  }
}

/**
 * Generate a proxy login URL for the user to authenticate.
 */
export function getProxyLoginUrl(config: InstitutionalConfig, targetDoi?: string): string {
  if (config.proxyType === "ezproxy") {
    const target = targetDoi
      ? `https://doi.org/${targetDoi}`
      : "https://scholar.google.com";
    return `https://${config.proxyBase}/login?url=${encodeURIComponent(target)}`;
  }
  return `https://${config.proxyBase}`;
}
