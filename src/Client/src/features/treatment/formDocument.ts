import type { MedicalForm } from '../../types';
import type { Visit } from '../../types';
import { queueLabel } from '../../constants/departments';

// ─── Form schema (shared by the editor and the printable document) ─────────────

export const SECTIONS: { key: string; label: string }[] = [
  { key: 'chiefComplaint', label: 'סיבת הפנייה / תלונה עיקרית' },
  { key: 'presentIllness', label: 'מחלה נוכחית (HPI)' },
  { key: 'pastMedicalHistory', label: 'רקע רפואי' },
  { key: 'allergies', label: 'רגישויות' },
  { key: 'homeMedications', label: 'בימים האחרונים נטל תרופות' },
  { key: 'vitalSigns', label: 'סימנים חיוניים' },
  { key: 'triage', label: 'טריאז׳' },
  { key: 'treatments', label: 'טיפולים ותרופות' },
  { key: 'physicalExam', label: 'בדיקה גופנית' },
  { key: 'administrationOrders', label: 'הוראות למתן' },
  { key: 'diagnoses', label: 'אבחנות' },
  { key: 'discussionAndPlan', label: 'דיון ותכנית' },
  { key: 'dischargeRecommendations', label: 'המלצות בשחרור' },
  { key: 'dischargeMedications', label: 'מרשם — תרופות בשחרור' },
  { key: 'orderedUnits', label: 'יחידות להזמנה' },
  { key: 'routing', label: 'ניתוב / הפניות' },
];

export const TEXT_SECTION_KEYS = [
  'chiefComplaint', 'presentIllness', 'pastMedicalHistory', 'triage',
  'physicalExam', 'discussionAndPlan', 'dischargeRecommendations', 'orderedUnits',
];

export function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Column definitions for printable tables (only filled rows reach here)
const PRINT_COLUMNS: Record<string, { key: string; label: string }[]> = {
  allergies: [{ key: 'drugName', label: 'תרופה' }, { key: 'type', label: 'סוג' }, { key: 'effect', label: 'השפעה' }, { key: 'determinationDate', label: 'ת.קביעה' }],
  vitalSigns: [{ key: 'date', label: 'תאריך' }, { key: 'time', label: 'שעה' }, { key: 'bp', label: 'ל"ד' }, { key: 'pulse', label: 'דופק' }, { key: 'respiration', label: 'נשימות' }, { key: 'o2Sat', label: 'סטורציה' }, { key: 'temperature', label: 'חום' }, { key: 'glucose', label: 'סוכר' }, { key: 'weight', label: 'משקל' }],
  treatments: [{ key: 'drugName', label: 'תרופה' }, { key: 'dosage', label: 'מינון' }, { key: 'startDate', label: 'התחלה' }, { key: 'duration', label: 'משך' }, { key: 'notes', label: 'הערות' }],
  administrationOrders: [{ key: 'drugName', label: 'תרופה' }, { key: 'dosage', label: 'מינון' }, { key: 'startDate', label: 'התחלה' }, { key: 'duration', label: 'משך' }, { key: 'notes', label: 'הערות' }],
  diagnoses: [{ key: 'diagnosis', label: 'אבחנה' }, { key: 'status', label: 'סטטוס' }, { key: 'severity', label: 'חומרה' }, { key: 'isPrimary', label: 'עיקרית' }],
  dischargeMedications: [{ key: 'drugName', label: 'תרופה' }, { key: 'dosage', label: 'מינון' }, { key: 'notes', label: 'הערות' }],
  homeMedications: [{ key: 'drugName', label: 'תרופה' }, { key: 'dosage', label: 'מינון' }, { key: 'notes', label: 'הערות' }],
  routing: [{ key: 'station', label: 'תחנה' }, { key: 'status', label: 'סטטוס' }, { key: 'arrivalDate', label: 'ת.הגעה' }],
};

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderTablePrint(label: string, key: string, rows: unknown[]): string {
  const cols = PRINT_COLUMNS[key];
  if (!cols) return '';
  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.map((r) => {
    const row = r as Record<string, unknown>;
    return '<tr>' + cols.map((c) => {
      const v = row[c.key];
      const cell = typeof v === 'boolean' ? (v ? '✓' : '') : v;
      return `<td>${esc(cell)}</td>`;
    }).join('') + '</tr>';
  }).join('');
  return `<section><h2>${esc(label)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
}

/**
 * Builds the full, self-contained HTML document for a visit's medical form —
 * showing ONLY filled fields. Used both for the in-app PDF-style view (in an
 * iframe) and for printing. Does not persist anything; it is rendered on the fly.
 */
export function buildFormDocument(form: MedicalForm, visit: Visit): string {
  const parts: string[] = [];

  const patientName = visit.patient ? `${visit.patient.firstName} ${visit.patient.lastName}` : '';
  const emblem = `<svg viewBox="0 0 32 29.6" width="34" height="31"><defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f6fc4"/><stop offset="1" stop-color="#e03131"/></linearGradient></defs><path fill="url(#h)" d="M23.6,0c-3.4,0-6.3,2.7-7.6,5.6C14.7,2.7,11.8,0,8.4,0C3.8,0,0,3.8,0,8.4c0,9.4,9.5,11.9,16,21.2c6.1-9.3,16-12.1,16-21.2C32,3.8,28.2,0,23.6,0z"/><rect x="14.7" y="6" width="2.6" height="10" rx="1.3" fill="#fff"/><rect x="11" y="9.7" width="10" height="2.6" rx="1.3" fill="#fff"/></svg>`;
  parts.push(`<div class="hdr">
    <h1>${emblem}<span>מלר"ד יד שרה — סיכום ביקור</span></h1>
    <div class="meta">
      <span>מטופל: <b>${esc(patientName)}</b></span>
      <span>ת.ז: ${esc(visit.patient?.identityNumber)}</span>
      <span>מס׳ תור: ${esc(queueLabel(visit.queueLetter, visit.queueNumber))}</span>
      <span>תאריך: ${esc(visit.admissionDate)} ${esc(visit.admissionTime)}</span>
    </div>
  </div>`);

  for (const { key, label } of SECTIONS) {
    if (TEXT_SECTION_KEYS.includes(key)) {
      const val = (form as unknown as Record<string, unknown>)[key];
      if (val && String(val).trim()) {
        parts.push(`<section><h2>${esc(label)}</h2><p>${esc(val).replace(/\n/g, '<br/>')}</p></section>`);
      }
    } else {
      const rows = (form as unknown as Record<string, unknown[]>)[key];
      if (Array.isArray(rows) && rows.length > 0) {
        parts.push(renderTablePrint(label, key, rows));
      }
    }
  }

  if (form.isSigned) {
    // Prescriber sign-off: name + license (+ specialist license) — the legally meaningful
    // part of a prescription / discharge letter.
    const lic = form.signedByLicense ? ` · מס׳ רישיון ${esc(form.signedByLicense)}` : '';
    const spec = form.signedBySpecialistLicense ? ` · מומחה ${esc(form.signedBySpecialistLicense)}` : '';
    parts.push(`<div class="sign">נחתם ע"י ${esc(form.signedByName)}${lic}${spec} — ${esc(formatDateTime(form.signedAt))}</div>`);
  }

  for (let i = 0; i < (form.addenda ?? []).length; i++) {
    const a = form.addenda[i];
    if (!a.text?.trim()) continue;
    parts.push(`<section class="addendum">
      <h2>תוספת לאחר חתימה #${i + 1}</h2>
      <p>${esc(a.text).replace(/\n/g, '<br/>')}</p>
      <div class="sign">${a.isSigned
        ? `נחתם ע"י ${esc(a.signedByName)} — ${esc(formatDateTime(a.signedAt))}`
        : '(טרם נחתם)'}</div>
    </section>`);
  }

  if (parts.length === 1) {
    parts.push('<section><p style="color:#888">לא מולאו שדות בטופס.</p></section>');
  }

  return `<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"/><title>סיכום ביקור</title>
    <style>
      * { font-family: Arial, sans-serif; box-sizing: border-box; }
      body { margin: 24px; color: #111; background: #fff; }
      .hdr h1 { font-size: 18pt; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
      .hdr h1 svg { flex-shrink: 0; }
      .meta { display: flex; gap: 18px; flex-wrap: wrap; font-size: 10pt; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 12px; }
      section { margin-bottom: 14px; page-break-inside: avoid; }
      h2 { font-size: 12pt; border-bottom: 1px solid #999; padding-bottom: 2px; margin: 0 0 6px; }
      p { font-size: 11pt; margin: 0; }
      table { width: 100%; border-collapse: collapse; font-size: 10pt; }
      th, td { border: 1px solid #999; padding: 3px 6px; text-align: right; }
      .sign { margin-top: 8px; font-size: 10pt; font-style: italic; color: #333; border-top: 1px dashed #999; padding-top: 4px; }
      .addendum { border: 1px solid #ccc; padding: 8px; border-radius: 6px; }
    </style></head><body>${parts.join('')}</body></html>`;
}
