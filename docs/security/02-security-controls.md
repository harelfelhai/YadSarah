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
- **הרסניות:** `POST /api/demo/seed` מבצע `TRUNCATE` ל-Patients/Visits/MedicalForms/Users/
  FeedbackReports/AuditLogs/FormLocks/QueueCounters. **נשמרים** מאגר התרופות (`Medications`)
  וההגדרות (`SystemSettings`) — נתוני-עזר/תצורה אמיתיים, לא נתוני בדיקה.
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
| מסך פרטי-האירוע: ניתוב-מחלקה ב-AI, הנחה/פטור בשליטת מנהל, סכום נגזר-שרת | **ניתוב-מחלקה** (`POST /api/reception/route-department`, `Reception/SM/Admin`) מחזיר שמות-מחלקה בלבד (לא-PHI). ה-classifier (`LlmDepartmentClassifier`, מודל **Haiku**) מופעל ב-config (`DepartmentRouting:Enabled=true`) אך **אינרטי ללא מפתח** (בלי `DepartmentRouting:ApiKey` → מחזיר null → fallback דטרמיניסטי, אין קריאה חיצונית). **כשמסופק מפתח** — סיבת-הקבלה + גיל/מין נשלחים ל-Claude API (Haiku) עם **timeout 8ש'** לכל קריאה (כשל/השהיה → fallback, לא חוסם את הקבלה); אילוץ ה-On-Prem בוטל 2026-06-19 אז זה מותר; זהו **PHI היוצא לספק חיצוני** — לפני הפעלה בייצור יש לוודא הסכם-עיבוד-נתונים/BAA מתאים והסכמה. מפתח ה-API נקרא מ-config/env (לא ב-DB, לא בקוד). הכשל אינו זורק לזרימת הקבלה. **הנחה/פטור** מותנה ב-step-up של **מנהל-משמרת/Admin** (`authorize-discount` + אימות-חוזר ב-`VisitsController.Create`), מוגבל-קצב (`auth`), מתועד (`DiscountAuthorized`/`DiscountAuthFailed`/`DiscountApplied`), עם `403` גנרי. **`TotalToCollect` נגזר-שרת** (`PricingService`) ו**הוסר מה-DTO** → הלקוח אינו יכול לקבוע מחיר. **מניעת over-posting:** `DiscountReason` נשמר רק עם אישור-מנהל מאומת, חותמת-המאשר נקבעת בשרת, ו-`VisitService.UpdateAsync` **אינו** מעתיק שדות הנחה/total → אין מעקף דרך `PUT`. מחיקת 11 עמודות-קבלה ישנות (מיגרציה הרסנית) — מטא-דאטה תפעולית, לא PHI קליני; בוצע בהסכמה (אין DB ייצור). **לפני הפעלת ה-AI בייצור:** להוסיף תקרת-אורך ל-`admissionReason`, rate-limit ייעודי ל-`route-department`, ותיעוד-audit לקריאת-הניתוב החיצונית (מעבר ל-global rate-limit הקיים). |
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

קבצים: `Domain/Entities/PatientIntakeSubmission.cs`, `Application/Services/IntakeSubmissionService.cs`,
`Api/Dtos/PublicIntakeRequest.cs`, `Api/Controllers/{PublicIntakeController,IntakeReviewController}.cs`,
`Api/Program.cs` (מדיניות `publicIntake`), `Client/src/features/intake/PublicIntakePage.tsx`,
`Client/src/features/reception/{IntakeReviewBoard,IntakeQrButton}.tsx`, `Client/src/api/intake.ts`.
