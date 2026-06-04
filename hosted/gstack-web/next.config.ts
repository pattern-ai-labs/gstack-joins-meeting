import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy /api/* to the broker so the browser never has to deal with CORS.
  // Set GSTACK_BROKER_URL=https://gstack-broker.fly.dev in your Vercel env.
  async rewrites() {
    const broker = process.env.GSTACK_BROKER_URL || "http://127.0.0.1:8787";
    return [
      { source: "/api/:path*", destination: `${broker}/api/:path*` },
      // Broker exposes /healthz + /readyz at the root for Fly's liveness
      // probe; we mirror them here so the frontend's sidebar status dot
      // can poll them via same-origin (no CORS).
      { source: "/healthz",    destination: `${broker}/healthz` },
      { source: "/readyz",     destination: `${broker}/readyz`  },
    ];
  },
};

export default nextConfig;
