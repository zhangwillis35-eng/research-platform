import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ali-oss", "proxy-agent", "urllib"],
};

export default nextConfig;
