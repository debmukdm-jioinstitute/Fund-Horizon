import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: [
    {
      command: "cd ../backend && .venv/bin/uvicorn app.main:app --port 8000",
      url: "http://localhost:8000/healthz",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    { command: "npm run dev -- --port 3000", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
  ],
});
