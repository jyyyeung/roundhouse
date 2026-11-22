import { defineConfig } from "vitest/config";

/**
 * Integration runs. Every file here talks to the same throwaway database and
 * truncates between tests, so two files running at once delete each other's
 * fixtures — the failure looks like a foreign-key violation, not like a test
 * ordering bug. Hence no file parallelism.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ["./src/test/unit-env.ts"],
  },
});
