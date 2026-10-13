import { defineConfig } from "vitest/config";
import path from "node:path";

const src = path.resolve(import.meta.dirname, "src");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^next\/cache$/, replacement: path.join(src, "test/mocks/next-cache.ts") },
      { find: /^server-only$/, replacement: path.join(src, "test/mocks/empty.ts") },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: { include: ["src/**/*.test.ts"], environment: "node", testTimeout: 30_000 },
});
