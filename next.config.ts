import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The gift voucher renderer reads its template and fonts from disk; make
  // sure they ship with every route that can produce a voucher.
  outputFileTracingIncludes: {
    "/api/stripe/webhook": ["./lib/gift-cards/assets/**"],
    "/api/cron/gift-cards": ["./lib/gift-cards/assets/**"],
    "/api/internal/gift-voucher": ["./lib/gift-cards/assets/**"],
    "/dashboard/gift-cards/[id]/voucher": ["./lib/gift-cards/assets/**"],
  },
  experimental: {
    staleTimes: {
      dynamic: 0, // Never serve stale client-side cache for dynamic pages
    },
  },
};

export default nextConfig;
