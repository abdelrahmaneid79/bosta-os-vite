import { defineConfig } from "vitest/config";
import path from "node:path";

// Test-only config: scope vitest to the live app and ignore archived reference code.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "_archive_nextjs/**", "_archive_old_next_app/**"],
  },
});
