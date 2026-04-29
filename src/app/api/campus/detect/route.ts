/**
 * Campus network auto-detection API.
 *
 * Detects which university's campus network the user is on
 * by checking the public IP against known campus IP ranges.
 *
 * Major Chinese university IP ranges (partial, covers main campuses):
 * - 中山大学: 202.116.0.0/16, 222.200.128.0/17
 * - 清华大学: 166.111.0.0/16, 101.5.0.0/16, 101.6.0.0/16
 * - 北京大学: 162.105.0.0/16, 115.27.0.0/16
 * - 复旦大学: 202.120.224.0/19, 175.186.0.0/16
 * - 上海交通大学: 202.120.0.0/17, 111.186.0.0/16
 * - 浙江大学: 210.32.0.0/16, 222.205.0.0/16
 * - 南京大学: 114.212.0.0/16, 210.28.128.0/17
 * - 武汉大学: 202.114.64.0/18
 * - 中国人民大学: 219.224.0.0/16
 * - 厦门大学: 210.34.0.0/16
 */
import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/ai/proxy-fetch";

interface CampusInfo {
  detected: boolean;
  university?: string;
  universityId?: string;
  ip?: string;
  vpnUrl?: string;
}

// IP prefix → university mapping
const IP_RANGES: Array<{ prefix: string; id: string; name: string; vpnUrl: string }> = [
  // 中山大学
  { prefix: "202.116.", id: "sysu", name: "中山大学", vpnUrl: "https://vpn.sysu.edu.cn" },
  { prefix: "222.200.", id: "sysu", name: "中山大学", vpnUrl: "https://vpn.sysu.edu.cn" },
  { prefix: "120.234.", id: "sysu", name: "中山大学", vpnUrl: "https://vpn.sysu.edu.cn" },
  // 清华大学
  { prefix: "166.111.", id: "tsinghua", name: "清华大学", vpnUrl: "https://sslvpn.tsinghua.edu.cn" },
  { prefix: "101.5.", id: "tsinghua", name: "清华大学", vpnUrl: "https://sslvpn.tsinghua.edu.cn" },
  { prefix: "101.6.", id: "tsinghua", name: "清华大学", vpnUrl: "https://sslvpn.tsinghua.edu.cn" },
  { prefix: "183.172.", id: "tsinghua", name: "清华大学", vpnUrl: "https://sslvpn.tsinghua.edu.cn" },
  { prefix: "183.173.", id: "tsinghua", name: "清华大学", vpnUrl: "https://sslvpn.tsinghua.edu.cn" },
  // 北京大学
  { prefix: "162.105.", id: "pku", name: "北京大学", vpnUrl: "https://vpn.pku.edu.cn" },
  { prefix: "115.27.", id: "pku", name: "北京大学", vpnUrl: "https://vpn.pku.edu.cn" },
  { prefix: "222.29.", id: "pku", name: "北京大学", vpnUrl: "https://vpn.pku.edu.cn" },
  // 复旦大学
  { prefix: "202.120.224.", id: "fudan", name: "复旦大学", vpnUrl: "https://vpn.fudan.edu.cn" },
  { prefix: "202.120.225.", id: "fudan", name: "复旦大学", vpnUrl: "https://vpn.fudan.edu.cn" },
  { prefix: "175.186.", id: "fudan", name: "复旦大学", vpnUrl: "https://vpn.fudan.edu.cn" },
  { prefix: "218.193.", id: "fudan", name: "复旦大学", vpnUrl: "https://vpn.fudan.edu.cn" },
  // 上海交通大学
  { prefix: "202.120.0.", id: "sjtu", name: "上海交通大学", vpnUrl: "https://vpn.sjtu.edu.cn" },
  { prefix: "202.120.1.", id: "sjtu", name: "上海交通大学", vpnUrl: "https://vpn.sjtu.edu.cn" },
  { prefix: "111.186.", id: "sjtu", name: "上海交通大学", vpnUrl: "https://vpn.sjtu.edu.cn" },
  { prefix: "202.112.26.", id: "sjtu", name: "上海交通大学", vpnUrl: "https://vpn.sjtu.edu.cn" },
  // 浙江大学
  { prefix: "210.32.", id: "zju", name: "浙江大学", vpnUrl: "https://rvpn.zju.edu.cn" },
  { prefix: "222.205.", id: "zju", name: "浙江大学", vpnUrl: "https://rvpn.zju.edu.cn" },
  // 南京大学
  { prefix: "114.212.", id: "nju", name: "南京大学", vpnUrl: "https://vpn.nju.edu.cn" },
  { prefix: "210.28.128.", id: "nju", name: "南京大学", vpnUrl: "https://vpn.nju.edu.cn" },
  { prefix: "210.28.129.", id: "nju", name: "南京大学", vpnUrl: "https://vpn.nju.edu.cn" },
  // 武汉大学
  { prefix: "202.114.64.", id: "whu", name: "武汉大学", vpnUrl: "https://vpn.whu.edu.cn" },
  { prefix: "202.114.65.", id: "whu", name: "武汉大学", vpnUrl: "https://vpn.whu.edu.cn" },
  // 中国人民大学
  { prefix: "219.224.", id: "ruc", name: "中国人民大学", vpnUrl: "https://vpn.ruc.edu.cn" },
  // 厦门大学
  { prefix: "210.34.", id: "xmu", name: "厦门大学", vpnUrl: "https://vpn.xmu.edu.cn" },
];

function detectFromIp(ip: string): CampusInfo {
  for (const range of IP_RANGES) {
    if (ip.startsWith(range.prefix)) {
      return {
        detected: true,
        university: range.name,
        universityId: range.id,
        ip,
        vpnUrl: range.vpnUrl,
      };
    }
  }
  return { detected: false, ip };
}

export async function GET(request: Request) {
  // Method 1: Check X-Forwarded-For header (works when deployed behind proxy)
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0].trim();
    const result = detectFromIp(ip);
    if (result.detected) return NextResponse.json(result);
  }

  // Method 2: Use native fetch WITHOUT proxy to get real campus IP
  // shell http_proxy would route through VeloceMan → overseas IP
  // We need the real local network IP
  try {
    const res = await globalThis.fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { ip: string };
      const result = detectFromIp(data.ip);
      return NextResponse.json(result);
    }
  } catch {
    // globalThis.fetch may also fail due to no proxy for Google-blocked sites
  }

  // Method 3: Try Chinese IP detection service (always DIRECT in China)
  try {
    const res = await proxyFetch("https://myip.ipip.net/json");
    if (res.ok) {
      const data = (await res.json()) as { data?: { ip?: string } };
      if (data.data?.ip) {
        const result = detectFromIp(data.data.ip);
        return NextResponse.json(result);
      }
    }
  } catch {
    // ignore
  }

  // Method 4: Try ip.cn
  try {
    const res = await proxyFetch("https://www.ip.cn/api/index?ip=&type=0");
    if (res.ok) {
      const data = (await res.json()) as { ip?: string };
      if (data.ip) {
        const result = detectFromIp(data.ip);
        return NextResponse.json(result);
      }
    }
  } catch {
    // ignore
  }

  return NextResponse.json({ detected: false, error: "Could not determine IP" });
}
