import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { authInterrupts: true }, // enables forbidden() for real 403 responses
  // RFC 9116 location; the handler lives in a normal folder because dot-directories are awkward to manage.
  async rewrites() {
    return [{ source: "/.well-known/security.txt", destination: "/security-txt" }];
  },
};

export default nextConfig;
