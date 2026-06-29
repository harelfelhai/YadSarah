/**
 * UI Probe regression — reception form fixes (commit 562bcc4, verified live 2026-06-29).
 *
 * Guards the CORRECT behavior of the batch:
 *   #2 birth-date parsing without separators (8/6 digits)
 *   #5 birth-date future-block + no "היום" quick-button
 *   #3 health fund is a required field ("ללא" allowed, empty blocked)
 *   #4 discount/exemption needs a SHIFT-MANAGER/ADMIN step-up — a Reception user's
 *      own credentials are rejected (403), a manager's unlock it (charge → 0)
 *
 * Run:  npx playwright test tests/ui-probe/reception-fixes.spec.ts
 * Creds via env (never hardcoded): BASE_URL, RECEPTION_USER/RECEPTION_PASS, MANAGER_USER/MANAGER_PASS.
 * (Local demo seed uses reception1 / manager; password is the seeded demo password.)
 */
import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const RECEPTION_USER = process.env.RECEPTION_USER ?? 'reception1';
const RECEPTION_PASS = process.env.RECEPTION_PASS;
const MANAGER_USER = process.env.MANAGER_USER ?? 'manager';
const MANAGER_PASS = process.env.MANAGER_PASS;

async function login(page: Page, user: string, pass: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/שם משתמש|username/i).fill(user);
  await page.getByLabel(/סיסמה|password/i).fill(pass);
  await page.getByRole('button', { name: /כניסה|sign ?in|log ?in/i }).click();
  await expect(page).toHaveURL(/queue|reception/i);
}

/** Reach the patient-details step with a temporary ("זמני") identity so the fields are editable. */
async function openNewPatient(page: Page) {
  await page.goto(`${BASE_URL}/reception`);
  // dismiss the workstation room modal if present
  const skip = page.getByRole('button', { name: /דלג|skip|לא עכשיו/i });
  if (await skip.count()) await skip.first().click().catch(() => {});
  await page.getByRole('combobox', { name: 'סוג תעודה' }).click();
  await page.getByRole('option', { name: /זמני/ }).click();
  await page.getByRole('button', { name: 'אשר וחפש' }).click();
  await expect(page.getByLabel('תאריך לידה')).toBeEnabled();
}

test.describe('Reception form fixes — ui-probe regression', () => {
  test.skip(!RECEPTION_PASS, 'set RECEPTION_PASS to run');

  test('#2/#5 birth-date: separator-less parsing, future blocked, no "היום" button', async ({ page }) => {
    await login(page, RECEPTION_USER, RECEPTION_PASS!);
    await openNewPatient(page);
    const field = page.getByPlaceholder(/dd\/mm\/yyyy/i);

    // No "היום" quick-button inside the birth-date field.
    await expect(page.getByRole('button', { name: 'היום' })).toHaveCount(0);

    // Separator-less 8-digit → recognized.
    await field.fill('01012020');
    await expect(page.getByText('01/01/2020', { exact: false })).toBeVisible();

    // Separator-less 6-digit → recognized (century inference).
    await field.fill('150390');
    await expect(page.getByText('15/03/1990', { exact: false })).toBeVisible();

    // Future date → rejected with the future message.
    await field.fill('01012099');
    await expect(page.getByText('תאריך עתידי')).toBeVisible();

    // Garbage → not recognized.
    await field.fill('31022020'); // 31 Feb is invalid
    await expect(page.getByText('לא זוהה תאריך')).toBeVisible();
  });

  test('#3 health fund is required (empty blocked, "ללא" allowed)', async ({ page }) => {
    await login(page, RECEPTION_USER, RECEPTION_PASS!);
    await openNewPatient(page);

    // Fill every other required field, leave health fund empty.
    await page.getByLabel('שם פרטי').fill('בדיקה');
    await page.getByLabel('שם משפחה').fill('אוטומציה');
    await page.getByLabel('שם האב').fill('משה');
    await page.getByLabel('רחוב').fill('הרצל');
    await page.getByLabel('טלפון 1').fill('0501234567');
    await page.getByLabel('טלפון 2').fill('0507654321');
    await page.getByPlaceholder(/dd\/mm\/yyyy/i).fill('15/03/1990');
    await page.getByRole('combobox', { name: 'מין' }).click();
    await page.getByRole('option', { name: 'זכר' }).click();

    // Try to advance with health fund EMPTY → must stay on patient details, with a required error.
    await page.getByRole('button', { name: /המשך לפרטי קבלה/ }).click();
    await expect(page.getByLabel('קופת חולים')).toBeVisible();          // still on the details step
    await expect(page.getByText('שדה חובה')).toBeVisible();

    // Select "ללא" → now it advances to the visit-details step.
    await page.getByRole('combobox', { name: 'קופת חולים' }).click();
    await page.getByRole('option', { name: 'ללא' }).click();
    await page.getByRole('button', { name: /המשך לפרטי קבלה/ }).click();
    await expect(page.getByLabel('סיבת קבלה')).toBeVisible();
  });

  test('#4 discount needs a manager: reception creds rejected, manager creds unlock', async ({ page }) => {
    test.skip(!MANAGER_PASS, 'set MANAGER_PASS to run');
    await login(page, RECEPTION_USER, RECEPTION_PASS!);
    await openNewPatient(page);

    // Minimal valid patient to reach the visit-details step.
    await page.getByLabel('שם פרטי').fill('בדיקה');
    await page.getByLabel('שם משפחה').fill('הנחה');
    await page.getByLabel('שם האב').fill('משה');
    await page.getByLabel('רחוב').fill('הרצל');
    await page.getByLabel('טלפון 1').fill('0501234567');
    await page.getByLabel('טלפון 2').fill('0507654321');
    await page.getByPlaceholder(/dd\/mm\/yyyy/i).fill('15/03/1990');
    await page.getByRole('combobox', { name: 'מין' }).click();
    await page.getByRole('option', { name: 'זכר' }).click();
    await page.getByRole('combobox', { name: 'קופת חולים' }).click();
    await page.getByRole('option', { name: 'ללא' }).click();
    await page.getByRole('button', { name: /המשך לפרטי קבלה/ }).click();

    // Open the manager-gated discount modal (visible to reception).
    await page.getByRole('button', { name: /הנחה \/ פטור/ }).click();
    const dialog = page.getByRole('dialog', { name: /אישור הנחה/ });
    await expect(dialog).toBeVisible();

    // Reception's OWN credentials must be REJECTED (not a manager) — modal stays open, not unlocked.
    await dialog.getByLabel(/שם משתמש/).fill(RECEPTION_USER);
    await dialog.getByLabel(/סיסמה/).fill(RECEPTION_PASS!);
    const [forbidden] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/reception/authorize-discount')),
      dialog.getByRole('button', { name: 'אשר' }).click(),
    ]);
    expect(forbidden.status()).toBe(403);
    await expect(dialog).toBeVisible(); // still locked
    await expect(page.getByText(/אושר ע"י/)).toHaveCount(0);

    // A manager's credentials unlock it (server returns 200) and zero the charge.
    await dialog.getByLabel(/שם משתמש/).fill(MANAGER_USER);
    await dialog.getByLabel(/סיסמה/).fill(MANAGER_PASS!);
    const [ok] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/reception/authorize-discount')),
      dialog.getByRole('button', { name: 'אשר' }).click(),
    ]);
    expect(ok.status()).toBe(200);
    await expect(page.getByText(/אושר ע"י/)).toBeVisible();
  });
});
