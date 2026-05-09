import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ali-oss", "proxy-agent", "urllib", "nodemailer", "unpdf", "mupdf"],
  typescript: {
    ignoreBuildErrors: true, // type checking done locally, skip on server to save memory
  },
  headers: async () => [
    {
      // HTML pages: no-cache so deployments take effect immediately
      // (prevents "Failed to find Server Action" after redeploy)
      source: "/((?!_next/static|_next/image|api/).*)",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Pragma", value: "no-cache" },
      ],
    },
  ],
};

export default nextConfig;
