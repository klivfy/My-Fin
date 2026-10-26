import { defineConfig, devices } from "@playwright/test";

/**
 * Testes E2E multi-engine: chromium (Chrome/Edge/Android), firefox e
 * webkit (Safari/iOS). Cobrem os três motores de browser exigidos pelo
 * suporte multiplataforma, além de viewports mobile.
 *
 * Os testes assumem o app servindo em localhost:3000 com um banco de teste
 * (DATABASE_URL). No CI, rodar após `prisma migrate deploy` + seed.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        port: 3000,
        reuseExistingServer: !process.env.CI,
      },
});
