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
| שינוי סטטוס בתור | ✓ | ✓ | ✓ | ✓ | ✓ |
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

## 13. סיכונים שיוריים (Residual Risks)

| סיכון | החלטה / בקרה מפצה |
|------|--------------------|
| JWT ב-`localStorage` (חשוף ל-XSS) | הוחלט להישאר (On-Prem) + הקשחות: CSP, כותרות, TTL קצר, ולידציית קלט. מעבר ל-httpOnly cookie אופציה עתידית. |
| TLS/הצפנה-בנייחה/גיבוי | תלויי-פריסה — ראו §6 במסמך הדרישות. |
| סיסמת admin ראשונית (9 תווים) | יש להחליף לסיסמה תואמת-מדיניות לפני עלייה לייצור. |
| סנכרון תרופות מ-API חיצוני (משרד הבריאות) | מחוץ לנתיב הקריטי; כשל אינו משבית את המערכת. ה-API מאחורי WAF — גיבוי ודאי ע"י ייבוא קובץ. יש לאמת זמינות מהשרת בישראל בעת הפריסה. |
| ~~שחרור מטופל ללא הגבלת תפקיד~~ (נסגר) | `PATCH /visits/{id}/status` הוגבל ל-`[Authorize(Roles="Reception,ShiftManager,Admin")]` (כמו `Create`/`Update`); רופא/אחות אינם יכולים עוד לשנות סטטוס/לשחרר. הפעולה ממשיכה להירשם כ-`StatusChanged` (מי/מתי/IP). |
