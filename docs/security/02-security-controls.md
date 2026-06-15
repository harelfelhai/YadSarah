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

`AddRateLimiter`/`UseRateLimiter` ב-`Program.cs`: מדיניות `auth` (20/דקה/IP על ההתחברות)
ומגביל גלובלי (300/דקה/IP). חורג → `429 Too Many Requests`.

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

## 10. סיכונים שיוריים (Residual Risks)

| סיכון | החלטה / בקרה מפצה |
|------|--------------------|
| JWT ב-`localStorage` (חשוף ל-XSS) | הוחלט להישאר (On-Prem) + הקשחות: CSP, כותרות, TTL קצר, ולידציית קלט. מעבר ל-httpOnly cookie אופציה עתידית. |
| TLS/הצפנה-בנייחה/גיבוי | תלויי-פריסה — ראו §6 במסמך הדרישות. |
| סיסמת admin ראשונית (9 תווים) | יש להחליף לסיסמה תואמת-מדיניות לפני עלייה לייצור. |
