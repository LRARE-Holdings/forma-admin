import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    staleTimes: {
      dynamic: 0, // Never serve stale client-side cache for dynamic pages
    },
  },
};

export default nextConfig;
