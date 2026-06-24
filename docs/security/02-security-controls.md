# בקרות האבטחה שיושמו — מימוש ומיקום בקוד

> מסמך זה מתאר את בקרות האבטחה שמומשו במערכת, עם הפניות לקבצים. משלים את
> [`01-legal-requirements.md`](01-legal-requirements.md) (הדרישות) ו-[`03-pentest-report.md`](03-pentest-report.md) (הוכחת העמידות).

## 1. אימות (Authentication)

- **JWT (HS256)** עם אימות issuer/audience/lifetime/signature; `ClockSkew=30s` לצמצום חלון
  תוקן פג. TTL מתצורה (`Jwt:AccessTokenHours`, ברירת מחדל 12 ש').
  קובץ: `src/Server/YadSarah.Api/Program.cs`, `Application/Services/AuthService.cs`.
- **אחסון סיסמאות:** BCrypt, work factor 12. `AuthService.HashPassword`.
- **מדיניות סיסמה:** ≥12 תווים + אות גדולה + אות קטנה + ספרה + תו מיוחד. נאכפת ביצירה/שינוי.
  קובץ: `Application/Services/PasswordPolicy.cs`, נאכף ב-`UserService`.
- **נעילת חשבון:** 5 כשלים → `LockoutEndAt = now+15m`; הצלחה/שחרור-מנהל מאפסים.
  קבצים: `AuthService.LoginAsync`, `Domain/Entities/User.cs` (`LockoutEndAt`),
  `UserService.ResetLoginFailuresAsync`. תגובות התחברות גנריות (אינן חושפות קיום חשבון).
- **אימות-חוזר (step-up) בנקודת החתימה:** חתימה על טופס/תוספת מחייבת הקלדה חוזרת של
  שם-משתמש+סיסמה, המאומתים מול ה-hash מבלי להנפיק טוקן. ראו §9.
  קובץ: `AuthService.VerifyCredentialsAsync`.

## 2. הרשאות (Authorization) — מטריצת תפקידים

תפקידים: `Reception, Nurse, Doctor, ShiftManager, Admin`.

| משאב / פעולה | Reception | Nurse | Doctor | ShiftManager | Admin |
|--------------|:---------:|:-----:|:------:|:------------:|:-----:|
| קריאת פרטי מטופל (דמוגרפיה) | ✓ | ✓ | ✓ | ✓ | ✓ |
| יצירת/עדכון מטופל | ✓ | עדכון | עדכון | ✓ | ✓ |
| שינוי **ת"ז** של מטופל | ✗ | ✗ | ✗ | ✓ | ✓ |
| יצירת/עדכון ביקור | ✓ | ✗ | ✗ | ✓ | ✓ |
| שינוי סטטוס קליני בתור (קריאה / פתיחת טיפול) | ✓ | ✓ | ✓ | ✓ | ✓ |
| **שחרור מטופל** (`Discharged`) | ✓ | ✗ | ✗ | ✓ | ✓ |
| **`FinishedTreatment`** (רק דרך חתימת טופס, לא דרך שינוי-סטטוס) | ✗ | ✗ | חתימה | ✗ | ✗ |
| **טופס רפואי (PHI קליני) — קריאה/עריכה** | ✗ | ✓ | ✓ | ✓ | ✓ |
| **חתימת טופס / תוספות** | ✗ | ✗ | ✓ | ✗ | ✗ |
| ניהול משתמשים (צפייה/עריכה) | ✗ | ✗ | ✗ | ✓ | ✓ |
| יצירת משתמש | ✗ | ✗ | ✗ | ✗ | ✓ |
| עריכת חשבון Admin / הענקת Admin | ✗ | ✗ | ✗ | ✗ | ✓ |
| הגדרות מערכת + יומן ביקורת | ✗ | ✗ | ✗ | ✗ | ✓ |

- **הפרדת PHI קליני:** `FormsController` מוגן ב-`[Authorize(Roles="Doctor,Nurse,ShiftManager,Admin")]`
  — קבלה חסומה. חתימה/תוספות מוגבלות ל-Doctor בשכבת השירות (`FormService`).
- **RBAC ברמת-סקשן בטופס הרפואי (`FormSectionPolicy`):** מקור-אמת יחיד בשרת (מראה-לקוח ב-`constants/formPolicy.ts`),
  נאכף ב-`FormService.UpdateSectionAsync` → `ForbiddenException`→403 על PATCH לא-מורשה. **האחות עורכת
  בדיוק 7 סקשנים** (`chiefComplaintNurse`, רגישויות, סימנים חיוניים, הוראות למתן, יחידות להזמנה, טיפולים,
  אבחנות); הרופא/סטודנט-רפואה עורך את כל היתר. שדה "סיבת הפנייה" פוצל לשני סקשנים — `chiefComplaintNurse`
  (אחות) ו-`chiefComplaint` (רופא) — וקבוצת **`NurseOnly`** מבטיחה שהרופא **אינו** רשאי לדרוס את סיבת-האחות
  (least-privilege/הפרדת-אחריות); ShiftManager/Admin שומרים override (עקבי עם חלון-העריכה אחרי חתימה).
  בלקוח הטופס מציג כברירת-מחדל רק את סקשני-התפקיד וכפתור "הצג שדות רופא" חושף את שדות הצוות-האחר שכבר
  מולאו — **תצוגה בלבד**; כל גישת-כתיבה נאכפת בשרת (הלקוח אינו מקור-האמת). diagnoses נשאר בכפוף לוולידציית
  הקטלוג הסגור גם לאחות.
- **מניעת הסלמה:** `UsersController.Update` חוסם מנהל-משמרת מעריכת חשבון Admin או הענקת Admin.
- **מניעת דליפת PHI דרך ביקור:** `VisitService.GetByIdAsync` אינו טוען טפסים; טפסים נשלפים רק
  דרך ה-controller המוגן. גם בצד הלקוח, כפתורי הפעולה הקליניים מוסתרים מקבלה (`QueuePage`).
- **שינוי סטטוס ביקור — הרשאה לפי מעבר-יעד:** `VisitsController.UpdateStatus` אוכף את הכלל
  ברמת הפעולה (לא חסימת-תפקיד גורפת): `Discharged` ל-Reception/ShiftManager/Admin בלבד,
  `FinishedTreatment` חסום (מושג רק דרך חתימה — ראו §9), ויתר המעברים הקליניים פתוחים לצוות
  הקליני. בצד הלקוח כפתור "שחרר" מוסתר מרופא/אחות (`QueuePage`, `isReception`).
- **מסך היסטוריה (`GET /api/visits/history`):** נגיש לכל משתמש מחובר (כפי שהוחלט — היסטוריה
  פתוחה לכולם), **ומתועד** כ-`Searched`. חושף דמוגרפיה + מטא-דאטה של ביקור + **שמות** הצוות
  המטפל בלבד (רופא חותם / עורכי הטופס) — **לא** תוכן קליני (הטפסים נטענים פנימית רק לחילוץ
  השמות ואינם מוחזרים). קלט מוגבל: `q`/`staff` עד 80 תווים, עד 5 אסימוני-חיפוש, תאריכים
  כ-`DateOnly` מאומת; שאילתות EF פרמטריות. קובץ: `Application/Services/VisitService.GetHistoryAsync`.

## 3. תיעוד ביקורת (Audit Trail)

- `AuditService` כותב רשומת `AuditLog` (append-only) עם: משתמש, פעולה, סוג ישות, מזהה, שדה,
  ערך, חותמת-זמן, **כתובת IP**. קבצים: `Application/Services/AuditService.cs`,
  `Domain/Entities/AuditLog.cs`, `Api/Controllers/AuditController.cs`.
- **מתועד:** התחברות (הצלחה/כשל/נעילה), קריאת מטופל + חיפוש, קריאת/עדכון/חתימת טופס רפואי,
  יצירת/עדכון/שינוי-סטטוס ביקור, ניהול משתמשים, שינוי הגדרות.
- **צפייה:** מסך `AuditPage` (Admin בלבד), `GET /api/audit`. היומן אינו ניתן לעריכה/מחיקה דרך ה-API.

## 4. בקרת קלט ומניעת over-posting

- **DTOs:** `VisitRequest` חושף רק שדות שהלקוח רשאי לקבוע; שדות שרת (Status, QueueNumber,
  תאריך/שעת קבלה, Version, חותמות) נקבעים בשרת. קובץ: `Api/Dtos/VisitRequest.cs`.
- **ולידציה אוטומטית:** `[ApiController]` + DataAnnotations (`[Required]`, `[StringLength]`,
  `[Range]`) → 400 נקי (ValidationProblemDetails).
- **מטופל:** שדות `Id`/חותמות נכפים בשרת; חיפוש מוגבל באורך (50) לצמצום עלות שאילתה.

## 5. מניעת SQL Injection

כל גישת הנתונים פרמטרית: EF Core LINQ + פרמטרים מפורשים ב-ADO.NET (מונה התור).
אין שרשור מחרוזות לתוך SQL. קובץ מייצג: `Application/Services/VisitService.cs`.

## 6. הגבלת קצב (Rate Limiting)

`AddRateLimiter`/`UseRateLimiter` ב-`Program.cs`: מדיניות `auth` (20/דקה/IP) על ההתחברות
**ועל נתיבי החתימה** (`/forms/{id}/sign`, `/forms/{id}/addenda/{id}/sign`) — מסכלת brute-force
על הסיסמה דרך החתימה; ומגביל גלובלי (300/דקה/IP). חורג → `429 Too Many Requests`.

## 7. תעבורה, כותרות וטיפול בשגיאות

- **TLS:** ב-`Production` — `UseHttpsRedirection` + `UseHsts`. בפיתוח HTTP (ראו §6 במסמך הדרישות).
- **כותרות אבטחה:** `SecurityHeadersMiddleware` — `X-Content-Type-Options:nosniff`,
  `X-Frame-Options:DENY`, `Referrer-Policy:no-referrer`, `Permissions-Policy`, `CSP`,
  והסרת `Server`/`X-Powered-By`. קובץ: `Api/Middleware/SecurityHeadersMiddleware.cs`.
- **CSP בצד הלקוח:** `src/Client/index.html` (baseline; גרסת ייצוא מחמירה מתועדת).
- **שגיאות:** `AddProblemDetails` + `UseExceptionHandler` ב-Production → תגובה מעוקרת ללא
  stack trace. Swagger/Developer page — פיתוח בלבד.

## 8. ניהול סודות והיגיינת מאגר

- `.gitignore` מחריג `appsettings.Development.json`, `.claude/settings.local.json`, סרטוני
  הקלטה (`videos old/`) ותמונות (`frames/`) — שעלולים להכיל PHI אמיתי.
- `appsettings.json` מכיל placeholders בלבד; סודות אמיתיים מחוץ למקור ובפריסה דרך env/Secret store.

## 9. חתימה ושלמות רשומה רפואית

טופס חתום ננעל לעריכה; תיקון אפשרי למנהל משמרת בחלון מוגדר בלבד; תוספות לאחר חתימה
משורשרות וחתומות בנפרד — שמירה על שלמות הרשומה הרפואית ואי-התכחשות (non-repudiation).
קובץ: `Application/Services/FormService.cs`.

**אימות-חוזר (step-up re-authentication) בעת חתימה.** כדי לחזק את ייחוס החתימה
(אי-התכחשות), חתימה על טופס או על תוספת אינה מתבצעת מתוקף הסשן בלבד — הרופא נדרש
**להקליד מחדש שם-משתמש וסיסמה** ברגע החתימה (בדומה לעיקרון 21 CFR Part 11 §11.200):

- **תאימות לזהות המחובר:** הסיסמה מאומתת מול ה-hash, **ו**הזהות חייבת להיות זהה
  למשתמש המחובר (`verified.Id == UserId`) — חתימה מיוחסת למי שנוכח בפועל, לא לבעל הסשן
  אם הושאר פתוח. כשל מחזיר `401` עם הודעה גנרית אחת (ללא credential-oracle).
- **אי-נעילה תפעולית:** כשל אימות-חוזר **אינו** מקדם את מונה נעילת-החשבון (כדי לא לנעול
  רופא באמצע משמרת בגלל שגיאת-הקלדה); ההגנה מפני brute-force היא **הגבלת-קצב** על נתיב
  החתימה (`[EnableRateLimiting("auth")]`). חשבון שכבר נעול אינו יכול לחתום.
- **תיעוד:** כל ניסיון כושל נרשם ל-audit כפעולה `SignReauthFailed` (עם IP); חתימה מוצלחת
  נרשמת כ-`Signed`. גם פעולות התוספת (addenda) על מסמך חתום נרשמות ל-audit: הוספת תוספת
  כ-`Created` וחתימת תוספת כ-`Signed`, שתיהן על `EntityType="MedicalFormAddendum"`.

קבצים: `Api/Controllers/FormsController.cs` (`Sign`, `SignAddendum`, `ReauthAsync`,
`SignRequest`), `Application/Services/AuthService.cs` (`VerifyCredentialsAsync`),
`Client/src/components/ReauthModal.tsx`, `Client/src/features/treatment/TreatmentFormPage.tsx`.

## 10. מסד התרופות (קטלוג חיצוני)

קטלוג התרופות (פנקס התכשירים של משרד הבריאות — שם + מספר רישום) נשמר ב-DB הפנימי ומשמש
את ה-autocomplete בטופס. **הנתיב הקליני אינו תלוי באינטרנט** — קריאת התרופות תמיד מקומית.

- **בידוד אינטרנט:** הרכיב היחיד שנוגע לרשת חיצונית הוא הסנכרון (שבועי-אוטומטי או יזום-מנהל).
  הוא **מחוץ לנתיב התפעולי הקריטי**, רץ עם timeout, וכשל בו אינו שובר דבר — נשמרת תמונת-המצב
  האחרונה (`MedicationSyncService` תופס כל חריגה ומחזיר תוצאה, ללא דליפת stack).
- **הרשאות:** חיפוש/autocomplete = צוות קליני בלבד (קבלה חסומה, כמו טפסים); **סנכרון וייבוא = Admin בלבד**.
  קובץ: `Api/Controllers/MedicationsController.cs`.
- **מקור רשמי:** "פנקס התרופות הרשומות בישראל" (משרד הבריאות / חופש המידע, `foi.gov.il/he/node/9671`)
  — קובץ **Excel (.xlsx)** עם העמודות `מספר_תכשיר` / `שם_בעברית` / `שם_באנגלית`. המערכת מזהה
  עמודות אוטומטית (`MedicationSyncService.BuildRecords`). אומת: 5,408 תרופות יובאו תקין.
- **הקשחת קלט/קובץ:** פרמטר חיפוש `q` מוגבל ל-100 תווים; ייבוא קובץ מוגבל ל-20MB
  (`[RequestSizeLimit]`); פענוח CSV/XLSX עמיד (זיהוי עמודות, ClosedXML). הנתונים אינם PHI (קטלוג ציבורי).
- **SSRF:** כתובת ה-API נשלטת ע"י Admin בלבד דרך הגדרה (`medications.apiUrl`), אינה מתקבלת
  מקלט משתמש מזדמן; התגובה מנותחת כ-JSON בלבד.
- **הגבלת-קצב:** טריגר הסנכרון תחת `[EnableRateLimiting("auth")]` למניעת הפעלות-יתר.
- **תיעוד:** סנכרון/ייבוא נרשמים ל-audit (`MedicationSync` / `MedicationImport`, כולל סטטוס וכמות).

קבצים: `Domain/Entities/Medication.cs`, `Application/Services/{MedicationCatalogService,
MedicationSyncService}.cs`, `Api/Services/MedicationSyncBackgroundService.cs`,
`Client/src/api/medications.ts`, `features/treatment/TreatmentFormPage.tsx` (DrugAutocomplete),
`features/admin/SettingsPage.tsx`.

### 10.1 שדה-טופס נוסף — "בימים האחרונים נטל תרופות" (תרופות-בית)

נוסף לטופס הרפואי section חדש `homeMedications` (תווית "בימים האחרונים נטל תרופות") — טבלה
מגובת-קטלוג של תרופות שהמטופל דיווח שנטל **לפני** ההגעה, במראה לסקשן `dischargeMedications`
הקיים. השינוי **אינו מוסיף נתיב-גישה, endpoint או DTO חדש** ולכן **יורש את כל בקרות הטופס**:

- **הרשאות (need-to-know):** הסקשן נכנס למפתח-ההרשאות של `FormSectionPolicy` — ברירת-מחדל
  רופא/מנהל/אדמין, ו**אחות** (נוסף ל-`NurseEditable` כי תרופות-בית נאספות באנמנזה). **קבלה
  חסומה** (כל הטופס מאחורי `FormsController` המוגן). המראה בצד-לקוח (`formPolicy.ts`) זהה.
- **רשימה סגורה (closed-list):** `homeMedications` הוא הסקשן הרביעי ב-`CatalogSectionProperty`
  (`FormService`), כך ששמות-תרופה נאכפים מול קטלוג ה-MoH הסגור — עם אותו grandfathering
  (ערכים קיימים אינם חוסמים) ודילוג כשהקטלוג ריק; הוא גם משותף בין טפסי שיוך-כפול (`SharedSections`).
- **מניעת over-posting:** השמירה עוברת ב-`UpdateSectionAsync` הקיים (PATCH גנרי לפי section-key),
  וה-`SetSection` הוא allowlist (מפתח לא-מוכר → חריגה) — אין mass-assignment.
- **תיעוד ושלמות:** אותו נתיב מתועד (`Updated`), אותה בקרת-גרסה/נעילת-חתימה. **אי-חשיפת PHI חדשה** —
  אותו טופס, אותה הרשאה, ללא logging חדש של נתוני-מטופל. מיגרציה `AddHomeMedications` מוסיפה עמודת
  `text` בודדת (`HomeMedicationsJson`), במראה לעמודות ה-`*Json` הקיימות.

## 11. דיווחי משתמשים (Feedback)

כפתור צף בכל מסך מאפשר לכל משתמש מחובר לדווח על תקלה/תיקון/שיפור. הדיווחים נשמרים ב-DB
ומנוהלים ע"י Admin (סטטוס, הערות-מנהל).

- **הרשאות:** יצירה = כל משתמש מחובר; **קריאה ועריכה = Admin בלבד** (`[Authorize(Roles="Admin")]`
  ברמת ה-action). קובץ: `Api/Controllers/FeedbackController.cs`.
- **🔒 חשיפת-PHI אפשרית:** התיאור החופשי עלול להכיל בטעות פרטי מטופל, ולכן הטבלה מטופלת
  כ**רגישה** — קריאה/עריכה ל-Admin בלבד, ובטופס מוצגת אזהרה "נא לא לכלול פרטים מזהים של מטופלים".
- **מחוץ ל-audit הקליני (במכוון):** דיווחים הם מידע **תפעולי, לא רפואי**, ולכן אינם נכתבים
  ליומן הביקורת (שמיועד למעקב גישה ל-PHI) — כדי לא לזהם אותו ברעש. אחריותיות-עריכה נשמרת
  על הרשומה עצמה (`UpdatedAt`/`UpdatedByUserId`).
- **מניעת over-posting:** המדווח אינו יכול לקבוע סטטוס/זהות/זמן — הזהות (`CreatedByUserId/Name/Role`),
  הזמן והנתיב נחתמים **בצד השרת** מתוך ה-claims; שדות הקלט מוגבלים ב-DTO ובאורך
  (תיאור ≤4000, מסך ≤100, שדה ≤150).
- **תיעוד-קונטקסט:** ה-URL נלכד אוטומטית לצורך איתור התקלה (אינו PHI).

קבצים: `Domain/Entities/FeedbackReport.cs`, `Application/Services/FeedbackService.cs`,
`Api/Controllers/FeedbackController.cs`, `Client/src/api/feedback.ts`,
`components/FeedbackWidget.tsx`, `features/admin/FeedbackPage.tsx`.

## 12. תצוגת היסטוריית מטופלים (`GET /api/visits/history`)

חיפוש/דפדוף בביקורי מטופלים (שם, ת"ז, תאריך, מחלקה, צוות מטפל, סטטוס).

- **הרשאות:** כל משתמש מחובר — מסך ההיסטוריה הוגדר **מכוונת** כנגיש לכל הצוות (החלטת לקוח;
  סביר לצוות מלר"ד קטן). חושף מטא-דאטה של ביקור + שמות צוות מטפל בלבד — **לא** תוכן קליני
  (טפסים נשלפים רק דרך `FormsController` המוגן; תצוגת ה-PDF עוברת דרכו).
- **תיעוד:** כל קריאה נרשמת ל-audit (`Searched`, `Visit`).
- **הקשחת קלט:** `q`/`staff` מוגבלים ל-80 תווים; כל הסינון/המיון/הספירה דרך EF פרמטרי (אין SQLi).
- **scale:** סינון, מיון ו-`COUNT` מתבצעים ב-DB על כלל הרשומות; מוחזר עמוד אחד בלבד (50),
  כדי שלא לטעון נתוני-יתר לזיכרון/רשת.

קבצים: `Application/Services/VisitService.cs` (`GetHistoryAsync`),
`Api/Controllers/VisitsController.cs`, `Client/src/features/history/HistoryPage.tsx`.

## 13. מצב הדגמה / זריעת נתונים (`/api/demo/*`)

כלי הדגמות שמייצר מאגר נתונים גדול שנראה אמיתי (משתמשים, ~1,000 טיפולים, מאגר תור של 300),
ומאפשר להזרים מטופלים לתור בלחיצה. **נתוני בדיקה בלבד — לעולם לא נתוני אמת.**

- **שער כפול (חובה):** (1) `[Authorize(Roles="Admin")]`; (2) דגל תצורה `Demo:Enabled` חייב להיות
  `true`. ברירת המחדל **כבויה** — הדגל מופיע רק ב-`appsettings.Development.json`. בפרודקשן
  (ללא הדגל) endpoints הפעולה מחזירים **404** — היכולת בלתי-נראית וחסומה לחלוטין.
- **הרסניות:** `POST /api/demo/seed` מבצע `TRUNCATE` ל-CareSteps/Patients/Visits/MedicalForms/Users/
  FeedbackReports/AuditLogs/FormLocks/QueueCounters. **נשמרים** מאגר התרופות (`Medications`)
  וההגדרות (`SystemSettings`) — נתוני-עזר/תצורה אמיתיים, לא נתוני בדיקה. ה-`TRUNCATE` הוא מחרוזת
  קבועה (שמות-טבלה literal, ללא קלט) — אין וקטור SQLi.
- **שאר הפעולות:** `POST /api/demo/fill-queue?count&replace` (מזריק מתוך מאגר ה-300 לתור היום,
  סטטוסים מעורבים), `POST /api/demo/clear-today` (מנקה את תור היום), `GET /api/demo/status`
  (ספירות + האם המצב פעיל; השער-לפי-דגל לא חל עליו כדי שה-UI ידע לדווח "כבוי").
- **תיעוד:** כל פעולה נרשמת ל-audit (`DemoSeeded` / `DemoQueueFilled` / `DemoQueueCleared`)
  **לאחר** הזריעה, כך שהרשומה שורדת את ה-TRUNCATE.
- **אימות:** נבדק — admin→200, רופא→403, אנונימי→401; הזריעה מייצרת 17/925/1000/300 ושומרת
  5,412 תרופות; ID ישראלי עם ספרת ביקורת תקינה; ה-UI (כרטיס "מצב הדגמה" בעמוד ההגדרות)
  גלוי רק כשהדגל דולק.

קבצים: `Application/Services/DemoDataService.cs`, `Api/Controllers/DemoController.cs`,
`appsettings.Development.json` (`Demo:Enabled`), `Client/src/api/demo.ts`,
`Client/src/features/admin/SettingsPage.tsx`.

## 14. סטטוס משמרת, מיפוי עמדה→חדר וייחוס מטפל

לוח **סטטוס משמרת** (חדרים + רוסטר עובדים, מצב פנוי/עסוק) למנהלים; מיפוי כל מחשב לחדר קבוע;
ושמירת **המטפל היחיד** בביקור בעת מעבר ל-`InTreatment` (הבסיס למצב עסוק/פנוי).

- **הרשאות (need-to-know):** `GET /api/shift-status` מוגן ב-`[Authorize(Roles="Admin,ShiftManager")]`
  — הלוח, החושף שמות מטופלים בטיפול + מיקום הצוות, נגיש למנהלים בלבד (אומת: רופא→`403`).
  ניהול עמדות — `GET /api/workstation` ו-`PUT /api/workstation/{id}` ל-Admin בלבד.
  `GET /api/workstation/me`, `GET /api/workstation/rooms` ו-`POST /api/workstation` פתוחים לכל
  משתמש מחובר **במכוון** (הגדרת חדר בפעם הראשונה ע"י כל עובד) — חושפים **שמות חדרים בלבד**, לא PHI.
- **חשיפת PHI ותיעוד:** הלוח מחזיר **שם** מטופל בטיפול (PHI) → כל צפייה נרשמת ל-audit
  (`Viewed`, `Visit`, שדה `shiftStatus`). שם הצוות + החדר שנוספו ל-broadcast של `QueueUpdate`
  ולתצוגת התור הם **מטא-דאטה תפעולי** (לא תוכן קליני), בהתאמה לנראות התור הקיימת לצוות.
- **מניעת over-posting / התחזות-מטפל:** זהות המטפל נחתמת **בשרת מתוך ה-JWT** (claims), לא מקלט
  הלקוח — הלקוח שולח רק `status` ו-`deviceId`. כך לא ניתן לייחס טיפול למשתמש אחר. החדר נגזר
  בשרת מ-`deviceId` דרך `WorkstationService.ResolveRoomAsync`.
- **בקרת קלט:** DTOs עם `[Required]`/`[StringLength]` — `deviceId` חסום ל-120 ו-`room` ל-60 בכל
  הנתיבים (כולל `deviceId` ב-`UpdateStatusRequest`); שם החדר עובר `Trim` בשרת.
- **SQLi:** כל גישת הנתונים (חיפוש `deviceId`, שאילתת אירועי ה-`Login` לחישוב הרוסטר) פרמטרית (EF).
- **On-Prem:** מזהה-העמדה נשמר ב-`localStorage` ונשלח בכניסה — אין תלות באינטרנט. חלון המשמרת
  נגזר מהגדרה `shift.startHours` (שעון ישראל), ללא קריאת-חוץ.

קבצים: `Domain/Entities/Workstation.cs`, `Domain/Entities/Visit.cs` (שדות `TreatingUser*`/`TreatmentRoom`),
`Application/Services/{WorkstationService,ShiftStatusService,VisitService}.cs`,
`Api/Controllers/{ShiftStatusController,WorkstationController,VisitsController,AuthController}.cs`,
`Client/src/features/shift/ShiftStatusPage.tsx`, `Client/src/components/WorkstationSetupModal.tsx`,
`Client/src/utils/deviceId.ts`, `Client/src/api/{shiftStatus,workstation}.ts`.

## 15. סיכונים שיוריים (Residual Risks)

| סיכון | החלטה / בקרה מפצה |
|------|--------------------|
| JWT ב-`localStorage` (חשוף ל-XSS) | הוחלט להישאר (On-Prem) + הקשחות: CSP, כותרות, TTL קצר, ולידציית קלט. מעבר ל-httpOnly cookie אופציה עתידית. |
| TLS/הצפנה-בנייחה/גיבוי | תלויי-פריסה — ראו §6 במסמך הדרישות. |
| סיסמת admin ראשונית (9 תווים) | יש להחליף לסיסמה תואמת-מדיניות לפני עלייה לייצור. |
| סנכרון תרופות מ-API חיצוני (משרד הבריאות) | מחוץ לנתיב הקריטי; כשל אינו משבית את המערכת. ה-API מאחורי WAF — גיבוי ודאי ע"י ייבוא קובץ. יש לאמת זמינות מהשרת בישראל בעת הפריסה. |
| ~~שחרור מטופל ללא הגבלת תפקיד~~ (נסגר) | `PATCH /visits/{id}/status` אוכף הרשאה **לפי מעבר-יעד**, לא חסימה גורפת של ה-endpoint: **שחרור** (`Discharged`) — Reception/ShiftManager/Admin בלבד (`User.IsInRole`, אחרת `403`); **`FinishedTreatment`** חסום כאן לחלוטין (מושג רק דרך חתימה ב-`FormsController` עם step-up re-auth — מניעת מעקף בקרת השלמות); מעברים קליניים (`Called`/`InTreatment`) פתוחים לצוות הקליני כך שרופא/אחות יכולים לפתוח טיפול. הפעולה ממשיכה להירשם כ-`StatusChanged` (מי/מתי/IP). *הערה: הגרסה הקודמת חסמה את כל ה-endpoint ל-3 התפקידים — מה שמנע מרופא לפתוח טיפול; המעבר ל-RBAC לפי-מעבר מתקן זאת תוך שמירת הגבלת השחרור.* |
| endpoint הזריעה ההרסני (`/api/demo/seed`) | חסום בפרודקשן ע"י דגל `Demo:Enabled` (ברירת מחדל כבוי → 404) **בנוסף** ל-`Admin` בלבד; מתועד ב-audit. יש לוודא שהדגל אינו מופעל בתצורת הייצור (ראו §13). |
| `deviceId` של העמדה נקבע בצד הלקוח (`localStorage`) | משתמש מאומת יכול לטעון `deviceId` של עמדה אחרת ולשבש את שיוך-החדר בלוח. **השפעה תפעולית בלבד** (תצוגת חדר בלוח/בתור) — אינו מקנה גישת-PHI, אינו עוקף אימות/RBAC, ודורש משתמש מאומת. מקובל לסביבת On-Prem אמינה; ניתן לקבע עמדה ע"י מנהל (`PUT /api/workstation`) בעת הצורך. |
| ~~`MainHub` — Reception מאומת יכול `JoinForm` ולקבל שידורי PHI~~ (נסגר) | ה-hub נשאר `[Authorize]` ברמת המחלקה (קבלה ממשיכה לקבל `QueueUpdate` דרך `Clients.All`), אך **`JoinForm` הוגבל** ל-`[Authorize(Roles="Doctor,Nurse,ShiftManager,Admin")]` — תואם ל-RBAC ב-`FormsController`. קבלה אינה יכולה עוד להצטרף לקבוצת-טופס ולקבל `FormSectionUpdated`/נוכחות (PHI). |
| ~~כשל אימות-חתימה מחזיר `401` ומנתק את המשתמש~~ (נסגר) | `FormsController.Sign`/`SignAddendum` מחזירים עתה **`403`** (לא `401`) על step-up re-auth שגוי — ה-session תקף, רק הסיסמה שהוקלדה מחדש שגויה; כך הדיאלוג מציג שגיאה ולא מפעיל את ה-logout הגלובלי של הלקוח על 401. |
| מסכי "קבלה ושחרור" (תפעוליים) נגישים בצד-לקוח | **הגנה-לעומק:** ה-routes `/reception` ו-`/reception/discharge/:id` עטופים ב-`RequireRole(Reception/ShiftManager/Admin)` ב-`App.tsx` (רופא/אחות → redirect ל-`/queue`), וכפתור "קבלת מטופל" בתור מוסתר מצוות קליני. זהו **שיקוף-לקוח** של ה-RBAC שכבר נאכף בשרת (יצירת מטופל ו-`Discharged` מוגבלים ל-Reception/SM/Admin → `403`); הלקוח אינו מקור-האמת. הפניית ה-login לפי-תפקיד (`LoginPage`) היא UX בלבד, אינה מקנה גישה. |
| ~~ולידציית קלט לא-עקבית בשדות חופשיים (סבב ui-probe 2026-06-18)~~ (נסגר) | הוקשחה ולידציית קלט בעקביות עם מדיניות שמות-המשתמש (§4): **שם חדר** (`WorkstationController`) דוחה `< >` (RegularExpression → `400`); **דמוגרפיית מטופל** (`PatientsController.Create/Update`) דוחה `< >` בשמות ומאמתת פורמט דוא"ל/טלפון בשרת (→ `400`) + מראה-לקוח באשף הקבלה; שגיאת שם-משתמש פסול עברה מ-`409` ל-`400` (`ArgumentException`). כל אלה הקשחות בלבד — אינן מרחיבות over-posting (שדות server-controlled עדיין נכפים), השאילתות פרמטריות (אין SQLi), והודעות השגיאה אינן חושפות PHI. **לא נמצא XSS פעיל** (React עושה escape בכל הרינדורים, כולל סריאליזציית ה-`innerHTML` של הדפסת המדבקות). |
| ~~כשל כניסה (סיסמה שגויה) לא מציג משוב~~ (נסגר) | מטפל ה-401 הגלובלי ב-`api/client.ts` רוענן את `/login` על **כל** 401 ומחק את הטופס+השגיאה לפני הצגתם. הנתיב `/auth/login` נפטר עתה מהרידיירקט הגלובלי כך שההודעה ("שם משתמש או סיסמה שגויים") נצבעת. אינו מחליש אימות — token אינו נקבע בכשל, וה-redirect של session פג-תוקף נשמר לכל שאר ה-endpoints. |
| ~~חיפוש "צוות מטפל" בהיסטוריה לא מוצא עורכי-שדה בעלי שם עברי~~ (נסגר) | מסנן הצוות ב-`VisitService.GetHistoryAsync` התאים שם גולמי מול `FieldEditsJson` שבו עברית שמורה escaped (`\uXXXX`). עתה מתאים גם לצורה ה-escaped (`JavaScriptEncoder.Default.Encode`). תיקון תצוגה/חיפוש בלבד — אינו מרחיב חשיפת-PHI מעבר למה ש-§12 כבר מתיר (תיק-מטופל לצוות מורשה), השאילתה פרמטרית (אין SQLi). |
| מעבר ל-RBAC רב-תפקידי (סיווג מקצועי רב-ערכי) | `User.Role` (יחיד) → `User.Roles` (קבוצה); ה-JWT פולט כל תפקיד כ-role-claim, ו-`[Authorize(Roles=…)]`/`IsInRole` מתאימים ל**לפחות-אחד** → **ההרשאות = איחוד**. גבולות הגישה הקיימים נשמרים: קבלה עדיין אינה ב-`FormsController` (PHI קליני), חתימה עדיין **רק רופא** (`Roles.Contains(Doctor)` ב-`FormService`), ושחרור/קבלה עדיין מוגבלים בשרת. **התפקידים החדשים** מתוחמים: סטודנט-רפואה/סיעוד = עריכת-טופס (ללא חתימה), מעבדה = **צפייה בלבד** (כל PATCH→403 דרך `FormSectionPolicy.CanEdit`). **הסלמת-הרשאות נחסמת:** יצירת משתמש = Admin בלבד; עדכון ע"י מנהל-משמרת חסום מהענקת/עריכת Admin (`req.Roles.Contains(Admin)`); כל שדות-המשתמש נכתבים מפורשות (אין over-posting); `ValidateRoles` דורש תפקיד אחד לפחות. שינויי משתמש נרשמים ל-audit (`Created`/`Updated` עם רשימת התפקידים). |
| השבתת חשבון לא-פעיל (120 יום) + תיעוד | `AuthService` משבית בכניסה חשבון שלא שימש 120+ יום (בסיס: כניסה אחרונה, או תאריך-יצירה למי שלא נכנס) — מצמצם משטח-תקיפה של חשבונות רדומים; הפעלה מחדש ע"י אדמין בלבד. האירוע **נרשם ל-audit** (`AccountAutoDeactivated`, מיוחס לחשבון) בנוסף ל-`LoginFailed`. כניסה מתועדת עתה גם עם **המחשב שממנו בוצעה** (`deviceId`). |
| חתימת רופא → שחרור אוטומטי + מרשם (#8) | חתימה מעבירה עתה את הביקור ישירות ל-`Discharged` (במקום `FinishedTreatment`) — **בשליטת הרשאת-החתימה הקיימת** (`FormService.SignAsync` דורש `Roles.Contains(Doctor)`); אין נתיב-הרשאה חדש, רק תוצאה נוספת של אותה פעולה מורשית, שממשיכה להירשם ל-audit כ-`Signed`. רישיון הרופא (+מרמ) **מצולם** על הטופס בעת החתימה (`SignedByLicense`) לצורך המרשם המודפס — זהו אישור-החותם עצמו (לא PHI של מטופל), ומופיע על המרשם הנמסר למטופל כנדרש. הדפסת הסיכום/מרשם רצה בצד-לקוח ב-iframe מבודד (אין PHI נשמר). שחרור-הקבלה נותר זמין למקרי-קצה (§15, שורת השחרור). |
| מסך פרטי-האירוע: ניתוב-מחלקה ב-AI, הנחה/פטור בשליטת מנהל, סכום נגזר-שרת | **ניתוב-מחלקה** (`POST /api/reception/route-department`, `Reception/SM/Admin`) מחזיר שמות-מחלקה בלבד (לא-PHI). ה-classifier (`LlmDepartmentClassifier`, ספק **Google Gemini**, מודל ברירת-מחדל `gemini-2.5-flash`) מופעל ב-config (`DepartmentRouting:Enabled=true`) אך **אינרטי ללא מפתח** (בלי `DepartmentRouting:ApiKey` → מחזיר null → fallback דטרמיניסטי, אין קריאה חיצונית). **כשמסופק מפתח** — סיבת-הקבלה + גיל/מין בלבד (ללא שם/ת"ז/תאריך-לידה) נשלחים ל-Gemini (`generativelanguage.googleapis.com`, מפתח ב-header `x-goog-api-key`) עם **timeout 8ש'** לכל קריאה. **מינימיזציית-נתונים:** סיבת-הקבלה היא כעת טקסט חופשי, ולכן נחתכת בשרת ל-200 תווים (אורך השדה הנשמר) לפני היציאה (`ReceptionController.RouteDepartment`). **אילוץ-מגדר קשיח (`DepartmentRoutingService`):** מטופל שמינו זכר **לעולם** אינו מנותב ל"נשים" בשום סיבת-קבלה — "נשים" מוסרת ממועמדי-הניתוב לזכר ב-`PreFilter` (לא מוצעת ל-AI), וקיים שער-גיבוי קשיח ב-`RouteAsync` שמחליף "נשים" שהוחזרה בכל-זאת (גם כשסיבת-הקבלה מזכירה "שבוע N") בבחירה הדטרמיניסטית הלא-נשים תלוית-הגיל; כלל-ההיריון והfallback כבר מגודרים ב-`!IsMale`. מונע שיבוץ-שגוי של זכר במסלול מחלקת-הנשים (פגיעה בפרטיות/כבוד). **תצוגת-מחלקה בקבלה:** ה-provenance (כלל/AI/ברירת-מחדל) נשמר לרשומה (`DepartmentAssignedByAi`/`DepartmentConfidence`) אך **אינו מוצג עוד** במסך הקבלה (צמצום-מידע), והמחלקה מוצגת כערך-תצוגה בלבד (לא שדה-קלט) — שינוי-תצוגה ללא השפעה על בקרה. `safetySettings=BLOCK_NONE` בקטגוריות הניתנות-להגדרה כדי שטקסט קליני (תסמינים/פציעות/מקרי-ילדים) לא יחסם — הקלט הוא תיאור-סיבה לא-מזהה. **כל כשל → fallback דטרמיניסטי ולא חוסם את הקבלה:** כשל/השהיה, חסימה, או מיצוי-מכסה (HTTP 429 ב-free-tier) מחזירים את הסט המסונן לבחירה ידנית; גוף-התגובה הגולמי נרשם ל-log לאבחון. אילוץ ה-On-Prem בוטל 2026-06-19 אז היציאה החיצונית מותרת; זהו **מידע מטופל היוצא לספק חיצוני** — לפני ייצור יש לוודא הסכם-עיבוד-נתונים מתאים, הסכמה, ו**הפעלת billing** (ה-free-tier מוגבל-קצב ויפיל לרוב ל-fallback בעומס). מפתח ה-API נקרא מ-config/env (לא ב-DB, לא בקוד). הכשל אינו זורק לזרימת הקבלה. **הנחה/פטור** מותנה ב-step-up של **מנהל-משמרת/Admin** (`authorize-discount` + אימות-חוזר ב-`VisitsController.Create`), מוגבל-קצב (`auth`), מתועד (`DiscountAuthorized`/`DiscountAuthFailed`/`DiscountApplied`), עם `403` גנרי. **`TotalToCollect` נגזר-שרת** (`PricingService`) ו**הוסר מה-DTO** → הלקוח אינו יכול לקבוע מחיר. קופ"ח המטופל נטען מה-DB בשרת (`VisitService.GetPatientHealthFundAsync`, EF פרמטרי) ולא מהלקוח, וחישוב הטבלה (קופ"ח × אופן-הגעה × פטור) הוא לוגיקה טהורה בשרת — אין זיוף מחיר/קופ"ח; מראת-הלקוח (`pricing.ts`) משמשת לתצוגה בלבד. **מניעת over-posting:** `DiscountReason` נשמר רק עם אישור-מנהל מאומת, חותמת-המאשר נקבעת בשרת, ו-`VisitService.UpdateAsync` **אינו** מעתיק שדות הנחה/total → אין מעקף דרך `PUT`. מחיקת 11 עמודות-קבלה ישנות (מיגרציה הרסנית) — מטא-דאטה תפעולית, לא PHI קליני; בוצע בהסכמה (אין DB ייצור). **לפני הפעלת ה-AI בייצור:** תקרת-אורך ל-`admissionReason` — **בוצע** (200 תווים); נותרו: rate-limit ייעודי ל-`route-department`, תיעוד-audit לקריאת-הניתוב החיצונית (מעבר ל-global rate-limit הקיים), והפעלת billing ל-Gemini (ה-free-tier אינו מספיק לעומס ייצור). |
| שכתוב טופס הקבלה: מספר זמני, מאגרי עיר/רחוב, שדה קרבת-איש-קשר | **endpoint מספר זמני** (`GET /api/patients/temp-id`) מוגבל ל-`Reception/ShiftManager/Admin`, מחזיר רק מספר 5-ספרתי פנוי (לא-PHI) ואינו חושף קיום של מספר נתון (אין enumeration). **מאגרי עיר/רחוב** הם נתוני-ייחוס לא-PHI: רשימת הערים מקובעת בצד-לקוח; הרחובות בטבלה מקומית (`Streets`) המוגשת מ-`GET /api/streets` מאחורי auth, נזרעת אופליין מ-data.gov.il **מחוץ לנתיב הקריטי** (כשל אינו זורק; דגם מאגר-התרופות) — סנכרון מסודרל ע"י `SemaphoreSlim` למניעת ריצות מקבילות שיכפלו רשומות; ייבוא/סנכרון = Admin בלבד (audit `StreetSync`/`StreetImport`). **שדה `DigitalContactRelation`** (קרבת איש-קשר) נכלל בגבול-האמון הקיים של `PatientsController` (אין over-posting — שדות server-controlled עדיין נכפים; שדות-שם עדיין נבדקים ל-`<>`), טקסט-חופשי שנשמר ומורנדר עם escaping של React/`esc()` (אין XSS). המרת התאריך העברי→לועזי רצה **כולה בצד-לקוח** (`@hebcal/hdate`, ללא רשת). |

## 16. קבלה עצמית ציבורית (Public Self-Service Intake)

עמוד ציבורי `/intake` **ללא התחברות** שבו מטופל ממלא בעצמו את פרטיו מהנייד (מגיע אליו דרך QR
שמוצג בדלפק). הטופס נכנס ל**טבלת staging נפרדת** (`PatientIntakeSubmission`) — **לא** לרשומות
המטופלים — והקבלה סוקרת אותו (צפייה + הדגשת סתירות מול מטופל קיים → "פתח בקבלה" / "בטל").

- **הרשאות (need-to-know):** `POST /api/public-intake` הוא `[AllowAnonymous]` ו**כתיבה-בלבד** —
  מחזיר רק `id` (Guid חדש), **אינו** מבצע חיפוש מטופל ו**אינו** מחזיר נתון קיים כלשהו. כל הקריאה
  והטריאז' (`GET /api/intake-submissions`, `GET /{id}` עם הסתירות, `POST /{id}/dismiss`,
  `POST /{id}/imported`) מוגנים ב-`[Authorize(Roles="Reception,ShiftManager,Admin")]`. לכן
  מזין אנונימי שמקליד ת"ז של מטופל קיים **אינו** מקבל בחזרה את נתוני המטופל — ה-diff מחושב ומוצג
  **רק לקבלה המורשית** (אין IDOR / חשיפת-PHI לאנונימי).
- **מניעת over-posting:** הקלט נקשר ל-DTO `PublicIntakeRequest` (קבוצת-שדות מפורשת) וממופה ב-
  `ToEntity()`; `Status`/`Id`/`SubmittedAt` נקבעים בשרת (`Status=Pending` תמיד). לטבלה **אין FK
  ל-`Patient`** — שום קלט אנונימי אינו נכנס לרשומות המטופלים. קידום לרשומת-מטופל/ביקור אמיתית
  מתבצע רק דרך `PatientsController`/`VisitsController` המאומתים **לאחר** סקירת הקבלה ("פתח בקבלה"
  ממלא-מראש את אשף הקבלה הרגיל; הצלחה → סימון `Imported`).
- **בקרת קלט:** `[StringLength]` על כל השדות, שמות דוחים `< >`, וולידציית פורמט דוא"ל/טלפון בשרת
  (במראה ל-`PatientsController.ValidatePatient`).
- **אי-חשיפת PHI במחלקה:** הדף הציבורי **אינו** מציג מחלקה ו**אינו** קורא ל-`route-department` —
  אין שליחת קלט-מטופל לספק AI חיצוני מהזרימה הציבורית (בשונה ממסך הקבלה המאויש, §15).
- **SQLi:** כל הגישה EF (LINQ פרמטרי) — ספירת ההגשות-לפי-מכשיר וחיפוש המטופל-הקיים לפי ת"ז.
- **XSS:** ערכי ההגשה מורנדרים רק דרך React (escaping אוטומטי; אין `dangerouslySetInnerHTML`).
- **תיעוד audit:** הגשה אנונימית נרשמת (`IntakeSubmitted`, `PatientIntakeSubmission`); צפייה
  וטריאז' של הקבלה נרשמים (`Viewed` / `Updated` עם `Imported`/`Dismissed`).
- **הגבלת הצפה (הקשחה):** תקרת **3 הגשות לכל מכשיר** (טוקן-`deviceId` ב-`localStorage`, חלון נגזר
  מהגדרה `intake.deviceLimit`/`intake.deviceWindowMinutes`) נספרת בשרת, **ובנוסף** מדיניות
  rate-limit לפי-IP (`publicIntake`, 10/דק') כבלם נגד הצפה. הטוקן ניתן-לעקיפה (ניקוי storage) — לכן
  הבלם הוא ה-rate-limit לפי-IP, וה-endpoint ממילא אינו חושף/משנה נתוני-מטופל. נשמר רופף דיו ל-Wi-Fi
  משותף בחדר המתנה (NAT — IP אחד למטופלים רבים).
- **route ציבורי בצד-לקוח במכוון:** `/intake` מחוץ ל-`RequireAuth`; השרת הוא גבול-האמון.
- **נתוני-ייחוס אנונימיים (`PublicReferenceController`, `[AllowAnonymous]`, מוגבל-קצב `publicIntake`):**
  העמוד הציבורי זקוק להשלמת כתובת ולרשימת ערים. `GET /api/public-ref/streets` מחזיר שמות-רחובות
  מקטלוג `Streets` (נתוני-ייחוס לא-PHI), ו-`GET /api/public-ref/cities/frequent` מחזיר **שמות-ערים
  בלבד** מסודרים לפי תדירות-רישום (נגזר מ-`GROUP BY Patients.City`; **המונה עצמו לעולם אינו נחשף**,
  רק הסדר — אגרגציה לא-PHI). אין כאן פרטי-מטופל, חיפוש-מטופל, או כתיבה. שאילתות EF פרמטריות (אין SQLi).
  ה-`/api/streets` המקורי נשאר מאחורי auth לצוות; זהו נתיב-קריאה אנונימי נפרד ומצומצם.
- **פתרון-סתירות שדה-אחר-שדה לפני קליטה (`IntakeSubmissionService.BuildDiffs` + `IntakeReviewBoard`):**
  ה-diff מציג כעת גם שדות ש**המטופל השאיר ריקים אך קיימים במערכת** (ולא רק סתירות-תוכן) — כדי שהקבלה
  תוכל לשאת אותם קדימה ולא לאבד נתון קיים. נתוני-המטופל-הקיים האלה נמסרים **לאותו קהל מורשה בלבד**
  (`Reception/ShiftManager/Admin`, שכבר רשאי לצפות/לערוך את רשומת-המטופל המלאה) — אין מחלקת-חשיפה
  חדשה, אין דליפה לאנונימי. הבחירה-לכל-שדה והמיזוג הם **כולם בצד-לקוח** ומפיקים מילוי-מראש לאשף-הקבלה;
  הכתיבה הסמכותית עדיין עוברת דרך `PatientsController`/`VisitsController` המאומתים על ולידציית-השרת ו-RBAC
  שלהם. הקבלה ממילא יכולה להקליד כל ערך בטופס, ולכן "בחר ערך-מטופל מול ערך-מערכת" אינה מעניקה יכולת חדשה
  (אין over-posting / הסלמת-הרשאה / נתיב-כתיבה חדש; ה-create הקיים נשאר מקור-האמת והוא הנרשם ל-audit).

קבצים: `Domain/Entities/PatientIntakeSubmission.cs`, `Application/Services/IntakeSubmissionService.cs`,
`Api/Dtos/PublicIntakeRequest.cs`, `Api/Controllers/{PublicIntakeController,IntakeReviewController}.cs`,
`Api/Program.cs` (מדיניות `publicIntake`), `Client/src/features/intake/PublicIntakePage.tsx`,
`Client/src/features/reception/{IntakeReviewBoard,IntakeQrButton}.tsx`, `Client/src/api/intake.ts`.

## 17. ניתוח נתונים למנהל (Analytics)

טאב **"ניתוח נתונים"** למנהלים: גרפים תפעוליים על-פני ציר הזמן (מטופלים לפי יום-בשבוע, הגעות
לפי חצי-שעה, ונוכחות בו-זמנית לפי חצי-שעה) לזיהוי עומסים וצווארי בקבוק. נוסף שדה `Visit.DepartedAt`
(חותמת עזיבה) כבסיס לגרף הנוכחות.

- **הרשאות (need-to-know):** `GET /api/analytics/overview` מוגן ב-`[Authorize(Roles="Admin,ShiftManager")]`
  — מנהלים בלבד (אומת: ללא token → `401`). ה-route `/analytics` והקישור בניווט מגודרים ב-
  `RequireRole(ShiftManager/Admin)` כ**שיקוף-לקוח**; השרת הוא גבול-האמון.
- **אי-חשיפת PHI:** התשובה היא **אך ורק נתון מצרפי** (ספירות/ממוצעים לכל יום-בשבוע ולכל תא חצי-שעה).
  אין שמות, ת"ז, טקסט-חופשי או כל מזהה-מטופל — חשיפה נמוכה אף מלוח המשמרת (§14, שחושף שמות).
  למרות זאת, כל צפייה **נרשמת ל-audit** (`Viewed`, `Analytics`, שדה `overview`).
- **בקרת קלט + הגנת-עומס:** `from`/`to` כ-`DateOnly?` (קלט פגום → `400` ע"י model-binding); הטווח
  **חסום ל-366 יום** (`MaxRangeDays`) כדי שקלט שנוצר-ידנית לא ימשוך נפח בלתי-חסום לזיכרון. האגרגציה
  רצה בזיכרון בשעון ישראל — ללא קריאות-חוץ.
- **מניעת over-posting:** ה-endpoint הוא GET קריאה-בלבד; השדה החדש `DepartedAt` נקבע **בשרת בלבד**
  (`VisitService.UpdateStatusAsync` / `FormService` במעבר ל-`Discharged`), **אינו** מועתק ב-
  `VisitService.UpdateAsync` ו**אינו** מופיע ב-DTO כלשהו → הלקוח אינו יכול לקבוע/לזייף אותו. זהו
  חותמת-זמן לא-PHI. רשומות legacy שהן `Discharged` ללא חותמת-עזיבה אינן נספרות בגרף הנוכחות
  (זמן-יציאה לא-ידוע) ולא נמרחות על הציר.
- **SQLi:** כל גישת-הנתונים EF (LINQ פרמטרי) — אין SQL גולמי.

קבצים: `Domain/Entities/Visit.cs` (`DepartedAt`), `Application/Services/AnalyticsService.cs`,
`Api/Controllers/AnalyticsController.cs`, `Api/Program.cs` (רישום DI), `Client/src/features/analytics/AnalyticsPage.tsx`,
`Client/src/api/analytics.ts`, `Client/src/App.tsx` + `layout/AppShell.tsx` (route+ניווט מגודרים).

## 18. סטטוס-תור רב-מימדי (צעדי-טיפול), הפניות לתחנות, ושיוך כפול (נשים)

מעבר מסטטוס-ביקור שטוח יחיד ל**אוסף צעדי-טיפול מקבילים** (`CareStep`): כל מטופל ממתין בו-זמנית
למספר גורמים (רופא + אחות + בדיקות), עם פעולות "קרא" / "הכנס" / "סיים" לכל צעד, הפניה לתחנות
(אולטרסאונד/בדיקות מעבדה/…), ושיוך כפול למחלקת נשים + מחלקה נוספת (שני טפסים, שורת-תור אחת).

- **צעדים התחלתיים בקבלה (תלויי-מחלקה):** הצעדים הראשונים נוצרים **בשרת** ב-`VisitService.CreateAsync`
  (במסגרת `POST /api/visits` המאומת — קבלה/מנהל-משמרת/אדמין — והמתועד כ-`Created`), ולא מקלט הלקוח:
  ברירת-מחדל אחות+רופא; אורטופדיה → רופא בלבד; עירוי → אחות בלבד; נשים-בהיריון → +אולטרסאונד/בדיקות מעבדה
  (+מוניטור עוברי משבוע 28). זיהוי ההיריון/שבוע נגזר **בשרת** מטקסט "סיבת הקבלה" (`PregnancyInfo`, אותו
  signal של ניתוב-המחלקה) — אין שדה-קלט חדש שהלקוח שולט בו, ואין egress חדש (טקסט-הסיבה כבר חסום
  ל-200 תווים לפני יציאתו ל-LLM). כל התחנות נשארות ברשימה הסגורה `CareStepCatalog.Stations`.
- **הרשאות (need-to-know):** כל ה-endpoints של צעדי-הטיפול ב-`VisitsController` מוגבלים לצוות הקליני
  ו**קבלה חסומה**: `POST /visits/{id}/steps` (הפניה לתחנה / העברת-מחלקה / שיוך-כפול-אוטומטי) ל-
  `Doctor,Nurse,ShiftManager,Admin,MedStudent,NursingStudent`;
  `PATCH /visits/{id}/steps/{stepId}` (קרא/הכנס/סיים) כולל גם `LabStaff` (לסגירת תחנת-מעבדה).
  נקודות-הקצה הנפרדות `PATCH /department` ו-`PATCH /dual-department` **הוסרו** — שינוי-מחלקה ושיוך-כפול
  קורים כעת דרך ההפניה בלבד.
  צעדי-הטיפול אינם תוכן קליני (PHI) — הם מטא-דאטה תפעולי (תפקיד נדרש, שם הקורא/המטפל, חדר),
  בהתאמה לנראות-התור הקיימת לצוות; הטופס הרפואי נותר מאחורי `FormsController` המוגן.
- **ייחוס פעולה ומניעת over-posting:** זהות מבצע הפעולה (`CalledBy*`/`StartedBy*`/`ReferredBy*`)
  נחתמת **בשרת מתוך ה-JWT** (claims), לא מקלט הלקוח; הלקוח שולח רק `action`/`labels`/`deviceId`.
  החדר נגזר בשרת מ-`deviceId` (`WorkstationService.ResolveRoomAsync`). הקלט נקשר ל-DTOs ייעודיים
  (`StepActionRequest`/`ReferStationRequest`) עם `[Required]`/`[StringLength]` — אין קשירה ישירה לישות `CareStep`.
- **בקרת קלט (whitelist בשרת):** שמות-התחנה/מחלקה מאומתים מול קטלוג סגור
  (`CareStepCatalog.IsKnownReferral`/`DepartmentStations`), ו**שיוך כפול נאכף בשרת**: נוצר אוטומטית
  מהפניה לשתי "רופא X" כשאחת המחלקות היא "נשים" (`CareStepService.ApplyDualByReferral`); זוג ללא נשים,
  או שלוש מחלקות ויותר, נדחים ב-`400` — אין מסלול לפצל ביקור לשתי מחלקות שרירותיות.
- **שלמות מחזור-החיים (שחרור):** חתימת טופס מסיימת את ה-track שלה בלבד; הביקור עובר ל-`Discharged`
  **רק כששני הטפסים חתומים** (`FormService.SignAsync`) — מונע שחרור מוקדם של מטופלת בתהליך כפול.
  אין נתיב-הרשאה חדש: חתימה עדיין דורשת `Doctor` + step-up re-auth (§9), והשחרור הידני נותר
  מוגבל (§2). הסטטוס הגס (`Visit.Status`) **נגזר** מהצעדים בשרת (`CareStepService.DeriveStatus`),
  ואינו ניתן לקביעה ישירה מהלקוח.
- **שדות-טופס משותפים בשיוך כפול:** מדדים/אלרגיות/עבר-רפואי מוזנים פעם אחת ומשתקפים לטופס האח
  של **אותו ביקור בלבד** (`f.VisitId == form.VisitId`), רק לאחר שהקורא עבר את `FormSectionPolicy.CanEdit`
  של אותו section, ו**לא** משתקפים לטופס חתום — אין מעקף הרשאה ואין כתיבה חוצת-ביקורים.
- **הפניה מרובת-תחנות, סיום-לא-רופא, ותחנת-מחלקה (תוך טיפול):** ההפניה (`POST /visits/{id}/steps`)
  מקבלת **כמה תחנות** (`Labels[]`), כל אחת מאומתת מול הקטלוג הסגור (`CareStepCatalog.IsKnownReferral`)
  — קלט whitelisted, EF פרמטרי. שלושה סוגי-הפניה, כולם whitelisted: תחנה רגילה (יוצרת צעד-המתנה עם
  חזרה-אוטומטית למפנה); **"אחות כללית"** (מוסיפה צעד-אחות **באותה מחלקה**, ללא העברת מחלקה); ו**תחנת-מחלקה**
  (`DepartmentStations` — "רופא X" לכל מחלקה עם רופא + "אחות עירוי" → עירוי) המעבירה את מחלקת הביקור עם
  provenance של **הפניה** (לא AI, לא ידני; audit `DepartmentReassignedByReferral`), שומרת אות-תור,
  ו**מיישבת את צעדי-הקלינאי לברירת-המחדל של המחלקה החדשה** (מבטלת תפקיד שהמחלקה החדשה אינה צריכה,
  משאירה תפקיד משותף, ומוסיפה חסר; הפניות-תחנה מפורשות אינן מושפעות). **סיום-לא-רופא**
  (`POST /visits/{id}/finish`, `CareStepNonDoctorFinished`) פתוח לצוות **שאינו רופא** בלבד
  (`Nurse,ShiftManager,Admin,NursingStudent,LabStaff` — Doctor חסום) ומסיים אך-ורק צעדי-**אחות**;
  לעולם אינו משחרר ואינו נוגע בצעד-רופא — **שחרור נשאר בלעדי לחתימת רופא** (§9).
- **שיוך-רופא ("קח תחתיי", ללא תחילת טיפול):** רופא משייך אליו מטופל הממתין לרופא דרך
  `PATCH /visits/{id}/steps/{stepId}` (action `claim`/`release`), **מוגבל לרופא/מנהל-משמרת/אדמין**
  (נבדק ב-`User.IsInRole`; אחות/סטודנט/מעבדה → 403). הצעד נשאר Waiting/Called — **אין שינוי סטטוס, אין
  שחרור, ו-analytics אינו מושפע**. עקיפה (re-claim) מותרת ומתועדת; **שחרור** מוגבל למשייך עצמו או למנהל
  (נאכף בשרת). השדות (`ClaimedBy*`) הם מטא-דאטה תפעולי (שם הרופא המשייך) ולא PHI; הקלט DTO ייעודי
  (`StepActionRequest`), EF פרמטרי — אין over-posting ואין SQLi.
- **הרשאת "הכנס" לפי מסלול + בלעדיות נוכחות (`CareStepService.EnterAsync`):** הכנסת מטופל ל"אצל"
  נאכפת בשרת בנקודה אחת — `EnsureMayEnter` מתיר לכל בעל-תפקיד להכניס **רק להמתנה התואמת למסלולו**
  (Doctor/MedStudent → צעד רופא; Nurse/NursingStudent → צעד אחות; **ShiftManager/Admin** — לכל
  המתנה; תחנות פתוחות לכל קלינאי), אחרת `ForbiddenException`→403. התפקידים נלקחים מ-claims של ה-JWT
  בצד-שרת (`CallerRoles` ב-`VisitsController`, `User.IsInRole`) — לא מקלט הלקוח; הלקוח רק **מסתיר**
  את הכפתור (`canEnterStep` ב-`constants/roles.ts`, מראה לכלל-השרת). בנוסף, כל הכנסה אוכפת **בלעדיות**:
  מטופל יכול להיות "אצל" גורם אחד בלבד וגורם מחזיק מטופל אחד בלבד — צעדי-`InProgress` אחרים של אותו
  ביקור/אותו מכניס מפונים. אלו **בקרות מהדקות** (least-privilege ו-state-integrity), הקלט הוא `stepId`
  מסוג Guid בנתיב ללא שדות-לקוח חדשים, וה-vacating הוא תופעת-לוואי דטרמיניסטית של פעולת ה-`enter`
  המתועדת (`CareStepEnter`) — ללא נתיב-גישה חדש ל-PHI.
- **הרשאת "קרא"/"סיים" לפי מסלול (`CareStepService.EnsureRoleMayActOnStep`):** בדומה ל"הכנס", גם
  פעולות "קרא" (`CallAsync`) ו"סיים" (`CompleteAsync`) על **צעד-קלינאי** נאכפות בשרת לפי מסלול-התפקיד —
  צעד-רופא רק לרופא, צעד-אחות רק לאחות/סטודנט-סיעוד, ShiftManager/Admin לכל מסלול, ותחנות פתוחות לכל
  קלינאי; אחרת `ForbiddenException`→403. הבדיקה **מהדקת מ"הכנס"** במסלול-הרופא: MedStudent רשאי
  *להיכנס* לצעד-רופא אך **אינו** רשאי לקרוא/לסיים אותו (החלטת-מדיניות 2026-06). מסבב זה ואילך הבדיקה
  בוחנת את **כל מערך-התפקידים** מתוך ה-claims (`CallerRoles`, כמו `EnsureMayEnter`) ולא תפקיד-יחיד —
  כך שמשתמש דו-תפקידי (למשל רופא+אחות) מורשה נכון בשני המסלולים, ונסגרת אי-עקביות שבה תפקיד-יחיד
  עלול היה לדחות פעולה לגיטימית. זו **הידוק** ולא הרחבה (לא נפתח מסלול חדש). הלקוח רק **מסתיר** את
  הכפתורים (`canActOnStep` ב-`constants/roles.ts`, מראה לכלל-השרת); הקלט הוא `stepId`/Guid בנתיב, וייחוס
  הקורא (`CalledBy*`) נחתם בשרת מה-JWT — אין שדות-לקוח חדשים, over-posting או SQLi.
- **תיעוד (audit):** כל פעולה נרשמת — הפניה (`CareStepReferred`), קרא/הכנס/סיים
  (`CareStepCall`/`CareStepEnter`/`CareStepComplete`), שיוך/שחרור-רופא (`CareStepClaim`/`CareStepRelease`),
  שיוך כפול (`DualDepartmentSet`), סיום-לא-רופא
  (`CareStepNonDoctorFinished`), והעברת-מחלקה-בהפניה (`DepartmentReassignedByReferral`), כולן על
  `EntityType="Visit"` עם IP.
- **SQLi:** כל גישת-הנתונים EF (LINQ פרמטרי); אין SQL גולמי. **XSS:** הצגת הצעדים בלקוח
  (`CareStepList.tsx`) דרך React בלבד (escaping אוטומטי, ללא `dangerouslySetInnerHTML`).
- **מצב הדגמה:** זריעת צעדי-טיפול ל-fill-queue מתבצעת רק דרך מסלול ה-Demo המגודר (§13), וניקוי
  היום מוחק גם את הצעדים (`ClearTodayAsync`). המחולל מייצר את התצוגה הרב-מימדית המלאה — צעדי
  קלינאי מקבילים, הפניות-תחנה (`CareStepCatalog.Stations`), ומסלול-כפול-נשים — כולם **נתונים
  סינתטיים בלבד** (משתמשי-דמו, ת"ז מחושב), נבנים בשרת ללא קשירת-לקוח, ועקביים עם
  `CareStepService.DeriveStatus` (אין סתירת סטטוס). `seed` כולל את `CareSteps` ב-`TRUNCATE` (§13).

קבצים: `Domain/Entities/CareStep.cs`, `Domain/Entities/{Visit,MedicalForm}.cs` (שדות track),
`Application/Services/{CareStepService,VisitService,FormService,PregnancyInfo}.cs`, `Api/Controllers/{VisitsController,FormsController}.cs`,
`Infrastructure/Data/AppDbContext.cs` (+ מיגרציה `MultiDimStatusAndDualDept`), `Client/src/components/CareStepList.tsx`,
`Client/src/constants/careSteps.ts`, `Client/src/features/{queue/QueuePage,treatment/TreatmentFormPage}.tsx`.

## 19. סבב הקשחת-אבטחה (2026-06-24) — פריסה web-hosted

סבב תיקונים בעקבות בדיקת-אבטחה מעמיקה (High+Medium) לקראת אירוח web. כל השינויים **מהדקים** בקרה
קיימת — אף אחד אינו מוסיף נתיב-גישה חדש ל-PHI, מרחיב הרשאה, או מכניס SQL גולמי / over-posting.

- **גבול-אמון של proxy ו-rate-limiting (H-1, `Program.cs`):** מאחורי TLS-terminating proxy (Render),
  `ForwardedHeaders` מוגדר עם `ForwardLimit=1` ורשימת-proxy מהימנה אופציונלית (`ForwardedHeaders:
  KnownProxyNetworks`) — כך שזיוף `X-Forwarded-For` לעקיפת המגבלות-פר-IP דורש גישה ישירה לקונטיינר.
  מאחר שגם ה-limiter הפר-IP וגם ה-cap הפר-מכשירי מפתחים על ערכים ניתנים-לסיבוב, נוסף **חסם-הצפה
  גלובלי לא-מבוסס-IP** ל-`POST /api/public-intake` (משורשר ל-`GlobalLimiter` ב-`CreateChained`) שמונע
  הצפת לוח-הקבלה.
- **ביטול-טוקן בזמן-בקשה (M-2, `User.cs`/`AuthService.cs`/`UserService.cs`/`Program.cs`):** נוסף
  `User.SecurityStamp` (לא-PHI, `[JsonIgnore]`), הנפלט כ-claim `stamp` ונבדק ב-`OnTokenValidated`
  בכל בקשה מאומתת יחד עם `IsActive`/lockout/expiry. סיבוב ה-stamp (בהשבתה, שינוי-תפקיד, איפוס-סיסמה)
  **מבטל מיידית את כל ה-JWT הקודמים** של המשתמש — מסגרת bearer חסרה זאת אחרת. תומך ב"צורך-לדעת":
  משתמש שתפקידו נשלל מאבד גישה לפני תפוגת-הטוקן.
- **בקרת-גישה (M-6, `CareStepService.cs`):** `EnsureRoleMayActOnStep` מהדק את `complete`/`call` של
  צעד-טיפול — צעד-רופא ניתן לקידום רק ע"י Doctor/ShiftManager/Admin (לא MedStudent), צעד-אחות רק
  ע"י Nurse/NursingStudent/ShiftManager/Admin; `ForbiddenException`→403. משלים את `EnsureMayEnter`
  הקיים (§18) ומונע מבעל-תפקיד נמוך לסמן צעד-רופא Done ולהיחתם כגורם-מטפל.
- **שלמות-מצב (M-8, `VisitService.UpdateStatusAsync`):** ביקור **משוחרר** (terminal) אינו ניתן
  לפתיחה-מחדש דרך PATCH-סטטוס → `409`, כדי שהסטטוס החי לא יתנתק מהרשומה החתומה.
- **ולידציית-קלט ורשימות-סגורות (M-7/M-9):** סיבות-הפטור נאכפות מול **רשימה-סגורה בשרת**
  (`PricingService.KnownExemptionReasons`, mirror ל-`constants/exemptionReasons.ts`) → טקסט-חופשי
  אינו יכול עוד לאפס חיוב; פטור-מלא נרשם ל-audit (`ExemptionApplied`). בקבלה הציבורית
  (`IntakeSubmissionService`) נדחה `DeviceId` ריק, נוסף cap פר-IP-מקור ותקרת-pending מוחלטת.
- **הגנת brute-force (M-3, `VisitsController`):** אישור-מנהל להנחה (re-auth שאינו מפעיל נעילת-חשבון
  בכוונה) קיבל **throttle ממופתח-שם-מנהל** (`IMemoryCache`, 5/5דק') + audit `DiscountAuthFailed`,
  כדי שנתיב יצירת-הביקור לא ישמש oracle לניחוש סיסמת-מנהל.
- **תיעוד (M-10, `FormsController.Export`):** ייצוא טופס מלא (קריאת-PHI בכמות) נרשם כעת
  `Viewed/export`, כמו שאר קריאות הטופס.
- **הגנת-PHI בצד-לקוח (M-4/M-5):** logout מאוחד מנקה את מטמון TanStack Query (`queryClient.clear()`)
  כדי שנתוני-מטופל לא ידלפו למשתמש הבא בעמדה משותפת; נוסף ניתוק-אוטומטי בחוסר-פעילות (15 ד') וכיבוד
  תפוגת-טוקן. גם כניסה חדשה מנקה מטמון קודם.
- **ניהול-סודות והיגיינת-DB (M-1/M-11, `Program.cs`/`appsettings.json`):** הוסר ערך-ה-placeholder של
  `Jwt:Secret` מ-appsettings.json (מסופק מ-env/Development.json); העלייה **נכשלת בקול** אם הסוד חסר
  או קצר מ-32 בתים. חיבור ה-DB מוצפן תמיד (`SSL Mode=Require`), ואימות-התעודה ניתן-להקשחה ל-`VerifyFull`
  דרך `Database__SslMode`/`Database__RootCert` (ברירת-מחדל תואמת ל-CA הפרטי של Render).

קבצים: `Api/Program.cs`, `Api/appsettings.json`, `Api/Controllers/{VisitsController,PublicIntakeController,FormsController}.cs`,
`Application/Services/{AuthService,UserService,CareStepService,PricingService,VisitService,IntakeSubmissionService}.cs`,
`Domain/Entities/User.cs` (+ מיגרציה `AddUserSecurityStamp`), `Client/src/{store/auth.ts,layout/AppShell.tsx,App.tsx,features/auth/LoginPage.tsx}`.

## 20. תור מודע-תפקיד: פעולות אוטומטיות, שדה-תחנה, ונוכחות-מנהל (2026-06-25)

לוח-התור הומר לפעולות **אוטומטיות לפי תפקיד** (קרא/הכנס/סיים כאייקונים מימין, ממוקדים ל-step של מסלול
הצופה), בתוספת שדה **"תחנה" למשתמש** ו**נוכחות-מנהל** מקבילה לתהליך הקליני.

- **פעולות-התור עדיין נאכפות בשרת (לא נפתח נתיב חדש):** האייקונים קוראים לאותם
  `PATCH /visits/{id}/steps/{stepId}` (call/enter/complete) שכבר אוכפים RBAC לפי-מסלול
  (`EnsureMayEnter`/`EnsureRoleMayActOnStep`, §18). בחירת-היעד האוטומטית בלקוח (`getViewerTrack` ב-
  `constants/roles.ts`) היא **נוחות-UI בלבד** — השרת הוא הסמכות; ניסיון לפעול על step לא-תואם →
  `403`. הכפתורים ה-inline בעמודות הוסרו (כפילות), אין שינוי הרשאה.
- **שדה `User.Station` (חדש, מיגרציה `AddStationAndManagerPresence`):** מטא-דאטה תפעולי (אנלוג ל-
  `Department` של רופא) הקובע לאיש-תחנה (LabStaff) לאיזו תחנה מיועדים ה-call/enter שלו בתור. נכתב רק
  דרך `UsersController` (Admin/ShiftManager, §2) ונחשף בתגובת ה-login (לצד `Department`) — אינו PHI ואינו
  מעניק הרשאה (הפעולה עצמה עדיין עוברת את ה-RBAC של ה-step).
- **נוכחות-מנהל (`POST /visits/{id}/manager-presence`, Admin/ShiftManager בלבד):** מנהל יכול "לקרוא/להכניס
  אליו" מטופל (`call`/`enter`/`clear`) — **בלי לגעת ב-`CareSteps`/ב-`Visit.Status`/ב-`DeriveStatus`**: אין
  המתנה-למנהל בתהליך הקליני, זו נוכחות-תצוגה מקבילה בלבד (`VisitService.SetManagerPresenceAsync`). מתועד
  (`ManagerPresence` עם הפעולה), משודר ב-SignalR, והחדר נגזר בשרת מ-`deviceId` (כמו call/enter רגיל) — אין
  שדה-לקוח חדש, over-posting, או חשיפת-PHI. השדות (`ManagerPresence*`) הם מטא-דאטה תפעולי (שם המנהל + חדר).

קבצים: `Domain/Entities/{User,Visit}.cs` (+ מיגרציה `AddStationAndManagerPresence`),
`Application/Services/{UserService,VisitService}.cs`, `Api/Controllers/{UsersController,AuthController,VisitsController}.cs`,
`Client/src/{constants/roles.ts,features/queue/QueuePage.tsx,components/CareStepList.tsx,features/admin/AdminPage.tsx,api/{users,visits}.ts}`.
