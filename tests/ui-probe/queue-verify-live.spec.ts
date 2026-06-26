/**
 * Live verification of the 13 queue-board UI fixes (commit "fix(queue): שיפורי תצוגה בלוח התור").
 * Runs against the live Render demo. Seeds the board via the demo API, then checks the items
 * that can be asserted and screenshots the visual ones for human review.
 *
 * Creds via env (never hardcoded): BASE_URL, DEMO_PASS (seeded demo password), SHOT_DIR.
 * Demo usernames are deterministic: admin / manager / doc1 (רפואה דחופה).
 */
import { test, expect, request as pwRequest, Page, APIRequestContext } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://yadsarah-demo.onrender.com';
const PASS = process.env.DEMO_PASS ?? '';
const SHOT = process.env.SHOT_DIR ?? '.';

// Target waiting patient (non-dual, רפואה דחופה) found during seeding — used by the #12 test.
let target: { visitId: string; stepId: string; name: string; queue: string } | null = null;

async function apiLogin(api: APIRequestContext, username: string): Promise<string> {
  const res = await api.post(`${BASE}/api/auth/login`, {
    data: { username, password: PASS, deviceId: `pw-${username}` },
  });
  expect(res.ok(), `login ${username} failed: HTTP ${res.status()}`).toBeTruthy();
  return (await res.json()).token;
}

async function uiLogin(page: Page, username: string) {
  // Suppress the first-login workstation room modal deterministically — AppShell reads this flag
  // (ys_ws_room_skipped) at mount, so the modal never appears and can't intercept clicks/hovers.
  await page.addInitScript(() => { try { localStorage.setItem('ys_ws_room_skipped', '1'); } catch { /* ignore */ } });
  await page.goto(`${BASE}/login`);
  await page.getByLabel('שם משתמש').fill(username);
  await page.getByLabel('סיסמה').fill(PASS);
  await page.getByRole('button', { name: 'כניסה למערכת' }).click();
  await expect(page).toHaveURL(/\/queue|\/reception/, { timeout: 20_000 });
  if (!page.url().includes('/queue')) await page.goto(`${BASE}/queue`);
  await expect(page.locator('.mantine-Modal-overlay')).toHaveCount(0, { timeout: 5_000 }).catch(() => {});
  await expect(page.locator('table')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(400);
}

test.beforeAll(async () => {
  test.skip(!PASS, 'set DEMO_PASS to run live verification');
  const api = await pwRequest.newContext();
  const token = await apiLogin(api, 'admin');
  const auth = { Authorization: `Bearer ${token}` };

  const fill = await api.post(`${BASE}/api/demo/fill-queue?count=50&replace=true`, { headers: auth });
  expect(fill.ok(), `fill-queue failed: HTTP ${fill.status()}`).toBeTruthy();

  // Find a non-dual רפואה דחופה patient with a WAITING doctor step for the #12 call/revert test.
  const qres = await api.get(`${BASE}/api/visits/queue`, { headers: auth });
  expect(qres.ok()).toBeTruthy();
  const visits: any[] = await qres.json();
  for (const v of visits) {
    if (v.secondaryDepartment) continue;
    if (v.receptionDepartment !== 'רפואה דחופה') continue;
    const ds = (v.careSteps ?? []).find(
      (s: any) => s.category === 'Clinician' && s.clinicianRole === 'Doctor' && s.status === 'Waiting');
    if (ds && v.patient) {
      target = {
        visitId: v.id, stepId: ds.id,
        name: `${v.patient.firstName} ${v.patient.lastName}`,
        queue: `${v.queueLetter}-${v.queueNumber}`,
      };
      break;
    }
  }
  console.log('[seed] target for #12:', JSON.stringify(target));
  await api.dispose();
});

test('board visual + structural checks (manager view)', async ({ page }) => {
  await uiLogin(page, 'manager');
  await page.waitForTimeout(800); // let row animations settle
  await page.screenshot({ path: `${SHOT}/01-board-manager.png`, fullPage: true });

  // #5 — "סיבת קבלה" column now comes before "מחלקה"
  const ths = await page.locator('thead th').allInnerTexts();
  const iReason = ths.findIndex((t) => t.includes('סיבת קבלה'));
  const iDept = ths.findIndex((t) => t.includes('מחלקה'));
  console.log('[headers]', JSON.stringify(ths));
  expect(iReason, 'סיבת קבלה header present').toBeGreaterThanOrEqual(0);
  expect(iDept, 'מחלקה header present').toBeGreaterThanOrEqual(0);
  expect(iReason, 'סיבת קבלה before מחלקה (#5)').toBeLessThan(iDept);

  // #8 — no "שחרר" button anywhere
  await expect(page.getByRole('button', { name: 'שחרר' }), 'no שחרר button (#8)').toHaveCount(0);

  // #11/#13 — old clinician prefixes gone; new terms present
  await expect(page.getByText('ממתין', { exact: false }), 'no old "ממתין" (#13)').toHaveCount(0);
  await expect(page.getByText('אצל ', { exact: false }), 'no old "אצל " badge (#13)').toHaveCount(0);
  expect(await page.getByText('בהמתנה', { exact: false }).count(), 'has "בהמתנה" (#13)').toBeGreaterThan(0);

  // #6 — at least one dual visit rendered as a 2-row split (lead cells rowSpan=2)
  const dualLeadCells = await page.locator('td[rowspan="2"]').count();
  console.log('[dual] rowspan=2 lead cells:', dualLeadCells);
  expect(dualLeadCells, 'a dual visit split into two rows (#6)').toBeGreaterThan(0);

  // #9 — "שייך אליי" (if present) is a real button
  const claim = page.getByRole('button', { name: 'שייך אליי' });
  console.log('[claim] שייך אליי buttons:', await claim.count());

  // #2 — in-treatment CLINICIAN badge (exact "בטיפול", inside the table) shows name/room only on
  // hover. Target the Badge, not the status-count strip label. Soft-checked + screenshot as evidence.
  const inTx = page.locator('tbody .mantine-Badge-root').filter({ hasText: /^בטיפול$/ }).first();
  if (await inTx.count()) {
    await inTx.scrollIntoViewIfNeeded();
    await inTx.hover();
    const tip = page.getByRole('tooltip');
    const shown = await tip.isVisible({ timeout: 3000 }).catch(() => false);
    console.log('[tooltip #2]', shown ? (await tip.innerText().catch(() => '')).slice(0, 80) : 'no tooltip appeared');
    await page.screenshot({ path: `${SHOT}/02-hover-tooltip.png` });
  } else {
    console.log('[tooltip #2] no InProgress clinician badge present to hover');
  }
});

test('#12 — נקרא shows for ~10s then reverts, קרא reappears (doctor view)', async ({ page }) => {
  test.skip(!target, 'no waiting רפואה דחופה doctor step was seeded');
  await uiLogin(page, 'doc1');
  const t = target!;
  const row = page.locator('tbody tr', { hasText: t.name }).first();
  await expect(row, `target row ${t.queue} ${t.name}`).toBeVisible({ timeout: 10_000 });

  // Before: waiting → actions cell has קרא + הכנס (2 buttons), badge "בהמתנה".
  const actions = row.locator('td').first();
  await expect(actions.getByRole('button'), 'waiting → 2 action icons').toHaveCount(2);
  await page.screenshot({ path: `${SHOT}/03a-before-call.png` });

  // Call the doctor step (as doc1) via API — equivalent to clicking "קרא".
  const api = await pwRequest.newContext();
  const token = await apiLogin(api, 'doc1');
  const call = await api.patch(`${BASE}/api/visits/${t.visitId}/steps/${t.stepId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { action: 'call', deviceId: 'pw-doc1' },
  });
  expect(call.ok(), `call failed: HTTP ${call.status()}`).toBeTruthy();
  await api.dispose();

  // Fresh-called: badge "נקרא", actions cell shows only "הכנס" (1 button).
  await page.reload();
  await expect(page.locator('table')).toBeVisible({ timeout: 15_000 });
  const row2 = page.locator('tbody tr', { hasText: t.name }).first();
  await expect(row2, 'row shows נקרא after call').toContainText('נקרא', { timeout: 8000 });
  await expect(row2.locator('td').first().getByRole('button'), 'called → 1 action icon').toHaveCount(1);
  await page.screenshot({ path: `${SHOT}/03b-just-called.png` });

  // Wait out the 10s window — NO reload — the client timer must flip it back.
  await page.waitForTimeout(13_000);
  const row3 = page.locator('tbody tr', { hasText: t.name }).first();
  await expect(row3, 'נקרא gone after 10s (#12)').not.toContainText('נקרא');
  await expect(row3.locator('td').first().getByRole('button'), 'קרא reappears → 2 action icons').toHaveCount(2);
  await page.screenshot({ path: `${SHOT}/03c-after-revert.png` });
});
