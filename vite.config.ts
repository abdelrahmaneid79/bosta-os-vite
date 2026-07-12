import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // PORT is assigned by dev tooling (preview harness); 5173 is the fallback.
    port: Number(process.env.PORT) || 5173,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Keep the first paint light: vendor libs split from app code. xlsx and
        // tesseract are already dynamic imports and stay out of the main chunk.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          data: ["@supabase/supabase-js", "@tanstack/react-query"],
        },
      },
    },
  },
});
