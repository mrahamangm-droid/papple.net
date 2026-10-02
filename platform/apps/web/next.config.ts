import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { authInterrupts: true }, // enables forbidden() for real 403 responses
};

export default nextConfig;
