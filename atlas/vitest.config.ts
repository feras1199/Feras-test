import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"], environment: "node",
    // Database tests share one database, so with one set they run a file at a time.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
    },
  },
});
