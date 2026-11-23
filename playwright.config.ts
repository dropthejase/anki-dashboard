import { defineConfig, devices } from "@playwright/test";

// Set E2E_PORT to run beside a local `npm run dev` on 8787.
const port = Number(process.env.E2E_PORT ?? 8787);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run e2e:server",
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
