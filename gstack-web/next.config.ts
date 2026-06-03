import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy /api/* to the broker so the browser never has to deal with CORS.
  // Set GSTACK_BROKER_URL=https://gstack-broker.fly.dev in your Vercel env.
  async rewrites() {
    const broker = process.env.GSTACK_BROKER_URL || "http://127.0.0.1:8787";
    return [
      { source: "/api/:path*", destination: `${broker}/api/:path*` },
    ];
  },
};

export default nextConfig;
