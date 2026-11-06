import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: {
    baseURL: process.env.DIXORA_E2E_URL ?? "http://localhost:13000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "../../.codex-validation/playwright",
  reporter: [
    ["list"],
    ["json", { outputFile: "../../.codex-validation/playwright-results.json" }],
  ],
});
