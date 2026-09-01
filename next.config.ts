import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js finds the project root by searching upwards for a lockfile, which
  // walks past this repo to a stray one in the home directory. Pinning the
  // root keeps resolution — and the filesystem watcher — inside the project.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
