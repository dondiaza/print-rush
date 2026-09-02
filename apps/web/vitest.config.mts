import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The render layer is verified headlessly with Babylon's NullEngine, so no browser environment is
 * needed — but the path alias has to match tsconfig or the tests cannot import what they test.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
