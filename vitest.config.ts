import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environmentMatchGlobs: [
      // Server-side / Cloudflare logic: node runtime (Web Crypto available in Node 18+)
      ["src/server/**", "node"],
      // React component tests: jsdom runtime
      ["src/components/**", "jsdom"],
      ["src/routes/**", "jsdom"],
    ],
    // Default to node for anything not matched above
    environment: "node",
  },
});
