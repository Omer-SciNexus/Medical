import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pg", "ioredis"],
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};
const configure = (phase: string): NextConfig => ({ ...config,
  distDir: process.env.MERIDIAN_E2E === "1" ? ".next-test" : phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
});

export default configure;
