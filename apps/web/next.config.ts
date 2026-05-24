import type { NextConfig } from "next";

// API_URL is read at build time and baked into .next/routes-manifest.json.
// The Docker entrypoint patches the manifest on container startup so the
// pre-built image honours a runtime API_URL without a rebuild.
const API_URL = process.env.API_URL || "http://localhost:8080";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
    ],
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/ws/:path*", destination: `${API_URL}/ws/:path*` },
    ];
  },
};

export default nextConfig;
