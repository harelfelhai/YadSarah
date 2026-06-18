/**
 * UI Probe regression — reception/discharge role gating.
 *
 * Finding [MEDIUM] (ui-probe-fixes-2026-06-18): the /reception ("קבלה ושחרור")
 * screen was reachable by clinical roles (Nurse/Doctor) via the queue "קבלת מטופל"
 * button and via direct URL, even though the nav link is hidden — a dead-end since
 * the server enforces Reception/ShiftManager/Admin. These tests assert the CORRECT
 * (gated) behavior, so they fail until the route/button are role-gated.
 *
 * Run:  npx playwright test tests/ui-probe
 * Creds via env (never hardcoded): BASE_URL, NURSE_USER/NURSE_PASS, RECEPTION_USER/RECEPTION_PASS.
 * (Local demo seed uses nurse1 / reception1; password is the seeded demo password.)
 */
import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

async function login(page: Page, user: string, pass: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/שם משתמש|username/i).fill(user);
  await page.getByLabel(/סיסמה|password/i).fill(pass);
  await page.getByRole('button', { name: /כניסה|התחבר|sign ?in|log ?in/i }).click();
  await expect(page).toHaveURL(/queue|reception/i);
}

test.describe('Reception/discharge role gating — ui-probe regression', () => {
  test('nurse cannot reach /reception (route is role-gated)', async ({ page }) => {
    const user = process.env.NURSE_USER ?? 'nurse1';
    const pass = process.env.NURSE_PASS;
    test.skip(!pass, 'set NURSE_PASS to run');
    await login(page, user, pass!);

    // The reception nav link must be hidden for clinical roles.
    await expect(page.getByRole('link', { name: /קבלה ושחרור/ })).toHaveCount(0);

    // Direct navigation must NOT land on the reception/discharge screen.
    await page.goto(`${BASE_URL}/reception`);
    await expect(page.getByRole('heading', { name: 'קבלה ושחרור' })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/reception$/);
  });

  test('queue does not offer the admit button to a nurse', async ({ page }) => {
    const user = process.env.NURSE_USER ?? 'nurse1';
    const pass = process.env.NURSE_PASS;
    test.skip(!pass, 'set NURSE_PASS to run');
    await login(page, user, pass!);
    await page.goto(`${BASE_URL}/queue`);
    await expect(page.getByRole('button', { name: 'קבלת מטופל' })).toHaveCount(0);
  });

  test('reception staff CAN reach /reception (sanity)', async ({ page }) => {
    const user = process.env.RECEPTION_USER;
    const pass = process.env.RECEPTION_PASS;
    test.skip(!user || !pass, 'set RECEPTION_USER/RECEPTION_PASS to run');
    await login(page, user!, pass!);
    await page.goto(`${BASE_URL}/reception`);
    await expect(page.getByRole('heading', { name: 'קבלה ושחרור' })).toBeVisible();
  });
});
