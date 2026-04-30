import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ali-oss", "proxy-agent", "urllib"],
  typescript: {
    ignoreBuildErrors: true, // type checking done locally, skip on server to save memory
  },
};

export default nextConfig;
