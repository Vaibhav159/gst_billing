// This is an Indian GST app: every date it handles is an IST calendar date,
// and the FY/period bugs in audit A5/A10 are invisible under UTC. Runners
// default to UTC, so pin the suite to the timezone the app actually lives in
// or the date regression tests assert nothing.
process.env.TZ = "Asia/Kolkata";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
