import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@audit-crawler/core": path.resolve(__dirname, "packages/audit-core/src/index.ts")
    }
  },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 90_000
  }
});
