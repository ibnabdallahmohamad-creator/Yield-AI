import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge covers the farm list during live demos; compile and runtime errors still show.
  devIndicators: false,
  // Let phones / the projector machine on the same private network open `npm run dev`.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
};

export default nextConfig;
