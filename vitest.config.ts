import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    pool: "threads",
    maxWorkers: 2,
    minWorkers: 1,
    fileParallelism: false,
    testTimeout: 10000,
    hookTimeout: 15000,
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "apps/**/*.test.mjs",
      "apps/**/*.test.js",
      "scripts/**/*.test.mjs",
    ],
    exclude: ["node_modules", "dist"],
    globals: false,
    reporters: ["default"],
  },
});
