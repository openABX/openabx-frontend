import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["PORT"] ?? 3000);
const BASE_URL = process.env["E2E_BASE_URL"] ?? `http://127.0.0.1:${PORT}`;

/**
 * Two modes:
 *   1. `E2E_BASE_URL=<url> pnpm smoke` — runs against an already-running server
 *      (e.g., a Vercel preview). No webServer block.
 *   2. default — we start `@openabx/web` ourselves. We assume CI has already
 *      run `pnpm -C web run build`; in local dev we use `next dev` for speed.
 */
const webServerCmd = process.env["CI"]
  ? `pnpm --dir ../web run start`
  : `pnpm --dir ../web run dev`;

import type { PlaywrightTestConfig } from "@playwright/test";

const baseConfig: PlaywrightTestConfig = {
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
};

const config: PlaywrightTestConfig = process.env["E2E_BASE_URL"]
  ? baseConfig
  : {
      ...baseConfig,
      webServer: {
        command: webServerCmd,
        url: BASE_URL,
        env: { PORT: String(PORT) },
        timeout: 120_000,
        reuseExistingServer: !process.env["CI"],
      },
    };

export default defineConfig(config);
