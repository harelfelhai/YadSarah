import { defineConfig } from '@playwright/test';

// Minimal config for the ui-probe regression suite (added by the ui-probe skill).
// Install the runner once:  npm i -D @playwright/test && npx playwright install chromium
// Run:                      npx playwright test tests/ui-probe
//
// Credentials & base URL come from the environment — never hardcode secrets:
//   BASE_URL          (default http://localhost:5173)
//   TEST_ADMIN_USER / TEST_ADMIN_PASS     (an Admin or ShiftManager account)
//   TEST_DOCTOR_USER / TEST_DOCTOR_PASS   (a Doctor account — used for the RBAC test)
export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    // Each test gets a fresh context → empty localStorage → the workstation
    // setup modal appears on first login (as on a brand-new computer).
  },
});
