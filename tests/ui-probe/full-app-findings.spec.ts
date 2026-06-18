/**
 * UI Probe regression — full-app sweep (ui-probe-full-app-2026-06-18).
 *
 * Each test asserts the CORRECT behavior, so it FAILS until the bug is fixed,
 * then guards against regression. See the report for root-cause analysis.
 *
 * Run:  npx playwright test tests/ui-probe
 * Creds via env (never hardcoded): BASE_URL, ADMIN_USER/ADMIN_PASS,
 * RECEPTION_USER/RECEPTION_PASS. (Demo seed: admin / reception1; seeded demo password.)
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

// ── Finding #1 [MEDIUM] — wrong password gives no feedback ────────────────────
// The global 401 handler in api/client.ts force-reloads /login on ANY 401,
// including the login call itself, wiping the form + error before it renders.
test.describe('Finding #1 — failed login must show an error', () => {
  test('wrong password shows "שם משתמש או סיסמה שגויים" and stays on /login', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/שם משתמש|username/i).fill('admin');
    await page.getByLabel(/סיסמה|password/i).fill('definitely-wrong-password');
    await page.getByRole('button', { name: /כניסה|התחבר|sign ?in|log ?in/i }).click();

    // CORRECT behavior: an inline error appears, and we remain on /login.
    await expect(page.getByText('שם משתמש או סיסמה שגויים')).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/login/);
  });
});

// ── Finding #4 [MEDIUM] — staff history search misses Hebrew per-field editors ─
// FieldEditsJson is stored with \uXXXX-escaped Hebrew, so Contains(rawHebrew) never
// matches. Searching an editor shown under "ערכו:" must return their visit(s).
test.describe('Finding #4 — staff search finds per-field editors (Hebrew)', () => {
  test('searching an editor name returns their visits', async ({ page }) => {
    const user = process.env.ADMIN_USER ?? 'admin';
    const pass = process.env.ADMIN_PASS;
    const editor = process.env.HISTORY_EDITOR_NAME; // e.g. "טל חדד" — data-dependent
    test.skip(!pass || !editor, 'set ADMIN_PASS and HISTORY_EDITOR_NAME (a known per-field editor) to run');
    await login(page, user, pass!);

    await page.goto(`${BASE_URL}/history`);
    await page.getByLabel('צוות מטפל').fill(editor!);
    // Give the debounced query time to run.
    await page.waitForTimeout(1500);

    // CORRECT behavior: at least one matching row, NOT the empty-state text.
    await expect(page.getByText('לא נמצאו ביקורים תואמים')).toHaveCount(0);
    await expect(page.getByRole('row')).not.toHaveCount(1); // header row only == no data
  });
});

// ── Finding #3 [LOW] — admit wizard accepts malformed email / advances anyway ──
// The personal-details step should not advance with an invalid email format.
test.describe('Finding #3 — admit wizard validates email format', () => {
  test('malformed email blocks advancing to admission step', async ({ page }) => {
    const user = process.env.RECEPTION_USER ?? 'reception1';
    const pass = process.env.RECEPTION_PASS;
    test.skip(!pass, 'set RECEPTION_PASS to run');
    await login(page, user, pass!);

    await page.goto(`${BASE_URL}/reception`);
    // Step 1 — valid Israeli ID (checksum-valid; a throwaway not-yet-existing one).
    await page.getByRole('textbox', { name: 'מספר תעודה' }).fill('123456782');
    await page.getByRole('button', { name: 'אשר וחפש' }).click();

    // Step 2 — required names + a malformed email.
    await page.getByRole('textbox', { name: 'שם פרטי' }).fill('בדיקה');
    await page.getByRole('textbox', { name: 'שם משפחה' }).fill('בדיקה');
    await page.getByRole('textbox', { name: 'דוא"ל', exact: true }).fill('not-an-email');
    await page.getByRole('button', { name: 'המשך לפרטי קבלה ←' }).click();

    // CORRECT behavior: stay on step 2 with an email-format error (no admission step).
    await expect(page.getByText('פרטי קבלה')).toHaveCount(0);
    // (When implemented, also assert a visible email-format validation message.)
  });
});

/*
 * Not encoded as UI tests (server-side / low severity — see report):
 *  - #2  room-name field lacks <>/HTML validation (WorkstationController.SetRoomRequest).
 *  - #5  user-create with invalid name returns HTTP 409 instead of 400/422.
 * Suggested API-level assertions: POST /api/workstation with Room="<x>" should 400;
 * POST /api/users with FirstName="<x>" should 400 (currently 409).
 */
