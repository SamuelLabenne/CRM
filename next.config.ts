import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Classic dynamic rendering: almost every page is per-user, so we don't opt
  // into Cache Components / partial prefetching.
  cacheComponents: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
