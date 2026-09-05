import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig(base, {
  testMatch: ["**/*.spec.ts", "**/pages/hosting.ts"],
  use: { baseURL: "http://127.0.0.1:8788" },
  webServer: {
    command: "wrangler pages dev --ip 127.0.0.1 --port 8788",
    url: "http://127.0.0.1:8788",
    reuseExistingServer: false,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
