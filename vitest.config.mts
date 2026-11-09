import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// This harness never targets the configured Convex or Evolution deployments.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    server: { deps: { inline: ["convex-test"] } },
  },
});
