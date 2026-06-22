using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

// ── Result/DTO shapes returned to the demo controller ───────────────────────
public record DemoCredential(string Username, string Password, string Role, string FullName, string? Department);
public record SeedResult(int Users, int Patients, int Visits, int PoolPatients, List<DemoCredential> Credentials);
public record DemoStatus(int Patients, int Visits, int TodayQueue, int PoolAvailable, int Medications);

/// <summary>
/// Generates a large, realistic-looking demo dataset for presentations.
/// NON-PRODUCTION ONLY — the controller that exposes this is gated behind a
/// config flag and Admin role. The seed path WIPES all transactional/test data
/// (patients, visits, forms, feedback, audit, users) but deliberately preserves
/// the real reference data: the medication catalog and the system settings.
/// </summary>
public class DemoDataService(AppDbContext db, AuthService auth, SettingsService settings)
{
    // One shared password for every seeded account (meets the 12+ complexity policy).
    public const string DemoPassword = "YadSarah2026!";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly TimeZoneInfo IsraelTz =
        TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Israel Standard Time" : "Asia/Jerusalem");
    private static DateTime IsraelNow() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, IsraelTz);

    public static readonly string[] DemoDepartments = ["רפואה דחופה", "ילדים", "נשים"];

    // ── Hebrew name & locale pools ──────────────────────────────────────────
    private static readonly string[] MaleNames =
    [
        "דוד", "משה", "יוסף", "אברהם", "יעקב", "איתי", "נועם", "אורי", "איתן", "דניאל",
        "יהונתן", "אריאל", "עומר", "גיא", "רועי", "אלון", "תומר", "ניר", "עידו", "ליאור",
        "שמואל", "אליהו", "חיים", "ברוך", "מנחם", "אהרון", "יצחק", "נתנאל", "אלעד", "שגיא",
    ];
    private static readonly string[] FemaleNames =
    [
        "שרה", "רבקה", "לאה", "רחל", "מרים", "נועה", "תמר", "יעל", "מאיה", "שירה",
        "אביגיל", "הדר", "אורי", "ליה", "טליה", "רוני", "ענבל", "מיכל", "דנה", "אסתר",
        "חנה", "דבורה", "איילת", "גלית", "סיגל", "ורד", "אורלי", "קרן", "מורן", "ליאת",
    ];
    private static readonly string[] LastNames =
    [
        "כהן", "לוי", "מזרחי", "פרץ", "ביטון", "דהן", "אברהם", "פרידמן", "מלכה", "אזולאי",
        "כץ", "שפירא", "רוזנברג", "אוחיון", "גבאי", "חדד", "ישראלי", "ברק", "סגל", "אדרי",
        "טל", "שלום", "בן דוד", "נחום", "אלבז", "אשכנזי", "הראל", "פלד", "צדוק", "מורד",
        "וייס", "גולן", "ניסים", "עמר", "סויסה", "דיין", "ברקוביץ", "זוהר", "אלימלך", "רחמים",
    ];
    private static readonly string[] Cities =
    [
        "ירושלים", "תל אביב-יפו", "חיפה", "באר שבע", "בני ברק", "פתח תקווה", "נתניה",
        "אשדוד", "רחובות", "מודיעין עילית", "בית שמש", "אשקלון", "רמת גן", "חולון", "כפר סבא",
    ];
    private static readonly string[] Streets =
    [
        "הרצל", "ז'בוטינסקי", "ביאליק", "הנביאים", "הרב קוק", "ויצמן", "בן גוריון",
        "אלנבי", "רוטשילד", "סוקולוב", "ירושלים", "החלוצים", "האלון", "הזית", "הדקל",
    ];
    private static readonly string[] HealthFunds = ["מכבי", "מאוחדת", "כללית", "לאומית"];
    private static readonly string[] AdmissionReasons =
    [
        "כאב", "פציעה / חבלה", "חום", "קוצר נשימה", "בחילה / הקאות",
        "חולשה / עילפון", "בדיקה רפואית", "ייעוץ", "המשך טיפול", "תאונת דרכים", "אחר",
    ];
    private static readonly string[] ChiefComplaints =
    [
        "כאב בטן עז מזה יממה", "חום גבוה וצמרמורות", "כאב ראש חזק ובחילה", "קוצר נשימה במאמץ",
        "כאב חזה לוחץ", "סחרחורת וחולשה כללית", "חבלה ביד ימין לאחר נפילה", "שיעול מתמשך וכיח",
        "כאב גרון וקושי בבליעה", "כאב גב תחתון מקרין לרגל", "פריחה מגרדת בכל הגוף", "הקאות ושלשולים",
    ];
    private static readonly string[] Diagnoses =
    [
        "דלקת גרון חיידקית", "זיהום בדרכי השתן", "גסטרואנטריטיס חריפה", "מיגרנה",
        "שבר באמה (radius)", "ברונכיטיס חריפה", "התייבשות קלה", "יתר לחץ דם לא מאוזן",
        "דלקת אוזן תיכונה", "תגובה אלרגית", "כאב גב מכני", "חבלת ראש קלה",
    ];
    private static readonly string[] Triages = ["1 — דחוף ביותר", "2 — דחוף", "3 — בינוני", "4 — לא דחוף"];

    // Fallback drug names if the catalog is empty (it normally has ~5,400 rows).
    private static readonly string[] FallbackDrugs =
        ["אקמול", "אופטלגין", "נורופן", "אומפרזול", "אוגמנטין", "ונטולין", "פרמין", "דקסמול"];

    // ════════════════════════════════════════════════════════════════════════
    // STATUS
    // ════════════════════════════════════════════════════════════════════════
    public async Task<DemoStatus> StatusAsync()
    {
        var today = await CurrentQueueDateAsync();
        return new DemoStatus(
            Patients: await db.Patients.CountAsync(),
            Visits: await db.Visits.CountAsync(),
            TodayQueue: await db.Visits.CountAsync(v => v.AdmissionDate == today),
            PoolAvailable: await db.Patients.CountAsync(p => !p.Visits.Any()),
            Medications: await db.Medications.CountAsync());
    }

    // ════════════════════════════════════════════════════════════════════════
    // SEED  (wipe test data + generate users / history / pool)
    // ════════════════════════════════════════════════════════════════════════
    public async Task<SeedResult> SeedAsync(int visitCount = 1000, int repeatPatients = 50, int poolSize = 300)
    {
        // 1) Wipe transactional/test data. Medications + SystemSettings are preserved.
        // CareSteps is listed explicitly (it would also cascade from Visits) for clarity.
        await db.Database.ExecuteSqlRawAsync(
            """TRUNCATE TABLE "CareSteps", "MedicalForms", "FormLocks", "Visits", "Patients", "Users", "FeedbackReports", "AuditLogs", "QueueCounters" RESTART IDENTITY CASCADE;""");

        var rng = new Random(20260616);
        var usedIds = new HashSet<string>();
        var drugs = await LoadDrugNamesAsync();

        // 2) Users — one admin + clinical staff across the three departments.
        var passwordHash = auth.HashPassword(DemoPassword);
        var (users, credentials) = BuildUsers(passwordHash);
        db.Users.AddRange(users);
        await db.SaveChangesAsync();

        var doctorsByDept = users.Where(u => u.Roles.Contains(UserRole.Doctor))
            .GroupBy(u => u.Department!).ToDictionary(g => g.Key, g => g.ToList());
        var nursesByDept = users.Where(u => u.Roles.Contains(UserRole.Nurse))
            .GroupBy(u => u.Department!).ToDictionary(g => g.Key, g => g.ToList());

        var today = await CurrentQueueDateAsync();

        // 3) Patients + historical visits/forms.
        // `repeatPatients` patients get 2–3 visits each; the rest get one, until we hit visitCount.
        var patients = new List<Patient>();
        var visits = new List<Visit>();
        var forms = new List<MedicalForm>();

        int visitsLeft = visitCount;
        for (int i = 0; i < repeatPatients && visitsLeft > 0; i++)
        {
            var p = BuildPatient(rng, usedIds);
            patients.Add(p);
            int n = Math.Min(rng.Next(2, 4), visitsLeft); // 2–3 visits
            for (int v = 0; v < n; v++)
                AddHistoricalVisit(p, rng, today, drugs, doctorsByDept, nursesByDept, visits, forms);
            visitsLeft -= n;
        }
        while (visitsLeft > 0)
        {
            var p = BuildPatient(rng, usedIds);
            patients.Add(p);
            AddHistoricalVisit(p, rng, today, drugs, doctorsByDept, nursesByDept, visits, forms);
            visitsLeft--;
        }

        // 4) Per-(day, department-letter) running queue numbers for the historical visits.
        foreach (var v in visits)
            v.QueueLetter = Departments.LetterFor(v.ReceptionDepartment);
        foreach (var g in visits.GroupBy(v => (v.AdmissionDate, v.QueueLetter)))
        {
            int n = 1;
            foreach (var v in g.OrderBy(v => v.AdmissionTime))
                v.QueueNumber = n++;
        }

        // 5) The demo "queue pool": extra patients with NO visits. fill-queue draws from these.
        var pool = new List<Patient>();
        for (int i = 0; i < poolSize; i++)
            pool.Add(BuildPatient(rng, usedIds));

        db.Patients.AddRange(patients);
        db.Patients.AddRange(pool);
        await db.SaveChangesAsync();
        db.Visits.AddRange(visits);
        await db.SaveChangesAsync();
        db.MedicalForms.AddRange(forms);
        await db.SaveChangesAsync();

        // 6) A few feedback reports so the admin "user reports" tab isn't empty.
        SeedFeedback(rng, users);
        await db.SaveChangesAsync();

        return new SeedResult(users.Count, patients.Count, visits.Count, pool.Count, credentials);
    }

    // ════════════════════════════════════════════════════════════════════════
    // FILL QUEUE  (inject N pool patients into today's board, mixed statuses)
    // ════════════════════════════════════════════════════════════════════════
    public async Task<int> FillQueueAsync(int count, bool replaceToday)
    {
        count = Math.Clamp(count, 1, 200);
        var today = await CurrentQueueDateAsync();
        var rng = new Random();
        var drugs = await LoadDrugNamesAsync();

        if (replaceToday)
            await ClearTodayAsync();

        var staff = await db.Users.Where(u => u.IsActive).ToListAsync();
        var doctorsByDept = staff.Where(u => u.Roles.Contains(UserRole.Doctor) && u.Department != null)
            .GroupBy(u => u.Department!).ToDictionary(g => g.Key, g => g.ToList());
        var nursesByDept = staff.Where(u => u.Roles.Contains(UserRole.Nurse) && u.Department != null)
            .GroupBy(u => u.Department!).ToDictionary(g => g.Key, g => g.ToList());

        // Prefer the dedicated pool (patients with no visits); fall back to anyone not in today's queue.
        var poolIds = await db.Patients.Where(p => !p.Visits.Any())
            .Select(p => p.Id).Take(count * 3).ToListAsync();
        if (poolIds.Count < count)
        {
            var extra = await db.Patients
                .Where(p => !p.Visits.Any(v => v.AdmissionDate == today) && !poolIds.Contains(p.Id))
                .Select(p => p.Id).Take(count * 3).ToListAsync();
            poolIds.AddRange(extra);
        }
        var chosen = poolIds.OrderBy(_ => rng.Next()).Take(count).ToList();
        var patients = await db.Patients.Where(p => chosen.Contains(p.Id)).ToListAsync();

        // Per-letter running counters for today, seeded from any existing today's visits.
        var startByLetter = (await db.Visits.Where(v => v.AdmissionDate == today && v.QueueLetter != null)
            .GroupBy(v => v.QueueLetter!)
            .Select(g => new { Letter = g.Key, Max = g.Max(v => v.QueueNumber) })
            .ToListAsync())
            .ToDictionary(c => c.Letter, c => c.Max);

        var now = IsraelNow();
        var visits = new List<Visit>();
        var forms = new List<MedicalForm>();
        var careSteps = new List<CareStep>();
        int idx = 0;
        foreach (var p in patients)
        {
            var dept = DemoDepartments[rng.Next(DemoDepartments.Length)];
            var letter = Departments.LetterFor(dept);
            startByLetter.TryGetValue(letter, out var last);
            var queueNumber = last + 1;
            startByLetter[letter] = queueNumber;
            // Arrivals spread across the last ~6 hours, in arrival order.
            var minutesAgo = (patients.Count - idx) * rng.Next(3, 9);
            var arrival = now.AddMinutes(-minutesAgo);
            var status = LiveStatus(rng);

            // ~12% run a dual women's-track: a clinical professional classified the patient into a
            // second department, one side of which must be women's (the women's track is handled first).
            string? secondaryDept = null;
            if (rng.Next(100) < 12)
                secondaryDept = dept == Departments.Womens
                    ? (rng.Next(2) == 0 ? "רפואה דחופה" : "ילדים")
                    : Departments.Womens;

            var visit = new Visit
            {
                PatientId = p.Id,
                QueueNumber = queueNumber,
                QueueLetter = letter,
                Status = status,
                ReceptionDepartment = dept,
                AdmissionDate = today,
                AdmissionTime = TimeOnly.FromDateTime(arrival),
                AdmissionReason = AdmissionReasons[rng.Next(AdmissionReasons.Length)],
                CreatedAt = arrival.ToUniversalTime(),
                UpdatedAt = arrival.ToUniversalTime(),
                // Already-discharged arrivals get a departure instant (between arrival and now)
                // so today shows up on the census chart; everyone else is still "present".
                DepartedAt = status == VisitStatus.Discharged
                    ? arrival.AddMinutes(rng.Next(20, Math.Max(21, (int)(now - arrival).TotalMinutes))).ToUniversalTime()
                    : null,
            };
            if (secondaryDept is not null)
            {
                // Dual classification is a clinician's call — stamp the deciding professional.
                var decider = Pick(doctorsByDept, dept, rng);
                visit.SecondaryDepartment = secondaryDept;
                visit.DepartmentAssignedByAi = false;
                visit.DepartmentChangedByUserId = decider?.Id;
                visit.DepartmentChangedByName = decider?.DisplayName ?? decider?.FullName;
                visit.DepartmentChangedByRole = UserRole.Doctor;
                visit.DepartmentChangedAt = visit.UpdatedAt;
            }
            visits.Add(visit);
            careSteps.AddRange(BuildCareSteps(visit, dept, secondaryDept, rng, doctorsByDept, nursesByDept));

            // Waiting/Called patients haven't been seen yet → no clinical form.
            if (status is VisitStatus.InTreatment or VisitStatus.FinishedTreatment or VisitStatus.Discharged)
            {
                bool signed = status is VisitStatus.FinishedTreatment or VisitStatus.Discharged;
                forms.Add(BuildForm(visit, dept, arrival, rng, drugs, doctorsByDept, nursesByDept, signed));
            }
            idx++;
        }

        db.Visits.AddRange(visits);
        db.CareSteps.AddRange(careSteps);
        await db.SaveChangesAsync();
        db.MedicalForms.AddRange(forms);
        await db.SaveChangesAsync();
        return visits.Count;
    }

    // Demo care steps for a today-queue visit: the full multi-dimensional view — parallel nurse/doctor
    // waits, a station referral handled in parallel, and (for some) a dual women's-dept track. Always
    // kept consistent with the visit's coarse Status so CareStepService.DeriveStatus agrees.
    private static readonly string[] DemoRooms = { "חדר 1", "חדר 2", "חדר 3", "מלר\"ד א'", "מלר\"ד ב'" };

    private static IEnumerable<CareStep> BuildCareSteps(
        Visit visit, string primaryDept, string? secondaryDept, Random rng,
        Dictionary<string, List<User>> doctorsByDept, Dictionary<string, List<User>> nursesByDept)
    {
        var steps = new List<CareStep>();

        if (secondaryDept is not null)
        {
            // The women's track is handled first (TrackOrder 0); the other track trails it.
            var womens = primaryDept == Departments.Womens ? primaryDept : secondaryDept;
            var other = primaryDept == Departments.Womens ? secondaryDept : primaryDept;
            steps.AddRange(TrackSteps(visit, womens, 0, visit.Status, rng, doctorsByDept));
            var otherStatus = visit.Status is VisitStatus.FinishedTreatment or VisitStatus.Discharged
                ? VisitStatus.FinishedTreatment   // both processes finished
                : VisitStatus.Waiting;            // women's first → the other track hasn't started yet
            steps.AddRange(TrackSteps(visit, other, 1, otherStatus, rng, doctorsByDept));
        }
        else
        {
            steps.AddRange(TrackSteps(visit, primaryDept, 0, visit.Status, rng, doctorsByDept));
        }

        AddStationIfAny(visit, primaryDept, steps, rng, doctorsByDept);
        return steps;
    }

    // Nurse + doctor steps for one department track, reflecting a coarse status (the same mapping
    // CareStepService.DeriveStatus reverses): Waiting → both wait; Called → doctor paged; InTreatment
    // → nurse done + doctor in progress; Finished/Discharged → both done.
    private static IEnumerable<CareStep> TrackSteps(
        Visit visit, string dept, int trackOrder, VisitStatus coarse, Random rng,
        Dictionary<string, List<User>> doctorsByDept)
    {
        string Room() => DemoRooms[rng.Next(DemoRooms.Length)];

        CareStep Base(UserRole role)
        {
            var s = CareStepService.ClinicianStep(role, dept, trackOrder);
            s.VisitId = visit.Id;
            s.CreatedAt = visit.CreatedAt;
            s.UpdatedAt = visit.UpdatedAt;
            return s;
        }

        var nurse = Base(UserRole.Nurse);
        var doctor = Base(UserRole.Doctor);

        switch (coarse)
        {
            case VisitStatus.Called:
            {
                var d = Pick(doctorsByDept, dept, rng);
                doctor.Status = CareStepStatus.Called;
                doctor.CalledByUserId = d?.Id;
                doctor.CalledByName = d?.DisplayName ?? d?.FullName;
                doctor.CalledByRole = UserRole.Doctor;
                doctor.CalledRoom = Room();
                doctor.CalledAt = visit.UpdatedAt;
                break;
            }
            case VisitStatus.InTreatment:
            {
                var d = Pick(doctorsByDept, dept, rng);
                doctor.Status = CareStepStatus.InProgress;
                doctor.StartedByUserId = d?.Id;
                doctor.StartedByName = d?.DisplayName ?? d?.FullName;
                doctor.StartedByRole = UserRole.Doctor;
                doctor.StartedRoom = Room();
                doctor.StartedAt = visit.UpdatedAt;
                nurse.Status = CareStepStatus.Done;
                nurse.CompletedAt = visit.UpdatedAt;
                break;
            }
            case VisitStatus.FinishedTreatment:
            case VisitStatus.Discharged:
                nurse.Status = CareStepStatus.Done;
                nurse.CompletedAt = visit.UpdatedAt;
                doctor.Status = CareStepStatus.Done;
                doctor.CompletedAt = visit.UpdatedAt;
                break;
            // Waiting → both left as Waiting.
        }

        yield return nurse;
        yield return doctor;
    }

    // Some patients were referred to a station (US / blood test / CT / …) in parallel, stamped with the
    // referring doctor. Status stays consistent: a pending/in-progress station only on an in-treatment
    // visit, a done station only on a finished/discharged one.
    private static void AddStationIfAny(
        Visit visit, string dept, List<CareStep> steps, Random rng,
        Dictionary<string, List<User>> doctorsByDept)
    {
        CareStepStatus? stationStatus = visit.Status switch
        {
            VisitStatus.InTreatment when rng.Next(100) < 35 =>
                rng.Next(2) == 0 ? CareStepStatus.Waiting : CareStepStatus.InProgress,
            VisitStatus.Waiting when rng.Next(100) < 15 => CareStepStatus.Waiting,
            VisitStatus.FinishedTreatment or VisitStatus.Discharged when rng.Next(100) < 25 => CareStepStatus.Done,
            _ => null,
        };
        if (stationStatus is null) return;

        var doctor = Pick(doctorsByDept, dept, rng);
        var step = new CareStep
        {
            VisitId = visit.Id,
            Category = CareStepCategory.Station,
            Label = CareStepCatalog.Stations[rng.Next(CareStepCatalog.Stations.Count)],
            Status = stationStatus.Value,
            ReferredByUserId = doctor?.Id,
            ReferredByName = doctor?.DisplayName ?? doctor?.FullName,
            ReferredByRole = UserRole.Doctor,
            ReferredByDepartment = dept,
            CreatedAt = visit.CreatedAt,
            UpdatedAt = visit.UpdatedAt,
        };
        if (stationStatus == CareStepStatus.InProgress)
        {
            step.StartedRoom = DemoRooms[rng.Next(DemoRooms.Length)];
            step.StartedAt = visit.UpdatedAt;
        }
        else if (stationStatus == CareStepStatus.Done)
        {
            step.CompletedAt = visit.UpdatedAt;
        }
        steps.Add(step);
    }

    public async Task<int> ClearTodayAsync()
    {
        var today = await CurrentQueueDateAsync();
        var ids = await db.Visits.Where(v => v.AdmissionDate == today).Select(v => v.Id).ToListAsync();
        if (ids.Count == 0) return 0;
        await db.MedicalForms.Where(f => ids.Contains(f.VisitId)).ExecuteDeleteAsync();
        await db.FormLocks.Where(l => ids.Contains(l.FormId)).ExecuteDeleteAsync();
        await db.CareSteps.Where(s => ids.Contains(s.VisitId)).ExecuteDeleteAsync();
        await db.Visits.Where(v => ids.Contains(v.Id)).ExecuteDeleteAsync();
        return ids.Count;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Builders
    // ════════════════════════════════════════════════════════════════════════
    private static (List<User>, List<DemoCredential>) BuildUsers(string passwordHash)
    {
        var users = new List<User>();
        var creds = new List<DemoCredential>();
        var rng = new Random(7);

        void Add(string username, UserRole role, string? dept, string first, string last)
        {
            var full = $"{first} {last}";
            users.Add(new User
            {
                Username = username,
                PasswordHash = passwordHash,
                FirstName = first,
                LastName = last,
                FullName = full,
                Roles = new List<UserRole> { role },
                Department = dept,
                IsActive = true,
                Country = "ישראל",
                Mobile = "05" + rng.Next(0, 9) + rng.Next(1000000, 9999999),
            });
            creds.Add(new DemoCredential(username, DemoPassword, role.ToString(), full, dept));
        }

        Add("admin", UserRole.Admin, null, "מנהל", "מערכת");
        Add("manager", UserRole.ShiftManager, "רפואה דחופה", "אבי", "שביט");

        // 2 doctors + 2 nurses per department.
        var docFirst = new[] { "ד\"ר רון", "ד\"ר ענת", "ד\"ר יואב", "ד\"ר מירב", "ד\"ר אסף", "ד\"ר נטע" };
        var nurseFirst = new[] { "אחות חני", "אח עומר", "אחות דנה", "אח טל", "אחות שירן", "אח גיל" };
        int d = 0, nu = 0;
        for (int depi = 0; depi < DemoDepartments.Length; depi++)
        {
            var dept = DemoDepartments[depi];
            Add($"doc{depi * 2 + 1}", UserRole.Doctor, dept, docFirst[d], LastNames[d * 3 % LastNames.Length]); d++;
            Add($"doc{depi * 2 + 2}", UserRole.Doctor, dept, docFirst[d], LastNames[d * 3 % LastNames.Length]); d++;
            Add($"nurse{depi * 2 + 1}", UserRole.Nurse, dept, nurseFirst[nu], LastNames[nu * 5 % LastNames.Length]); nu++;
            Add($"nurse{depi * 2 + 2}", UserRole.Nurse, dept, nurseFirst[nu], LastNames[nu * 5 % LastNames.Length]); nu++;
        }

        Add("reception1", UserRole.Reception, null, "קבלה", "ראשית");
        Add("reception2", UserRole.Reception, null, "מאיה", "כהן");
        Add("reception3", UserRole.Reception, null, "ליאת", "לוי");

        return (users, creds);
    }

    private Patient BuildPatient(Random rng, HashSet<string> usedIds)
    {
        bool male = rng.Next(2) == 0;
        var first = male ? MaleNames[rng.Next(MaleNames.Length)] : FemaleNames[rng.Next(FemaleNames.Length)];
        var last = LastNames[rng.Next(LastNames.Length)];
        var birth = DateOnly.FromDateTime(DateTime.Today.AddDays(-rng.Next(365, 365 * 92)));
        var city = Cities[rng.Next(Cities.Length)];

        return new Patient
        {
            IdentityType = "תעודת זהות",
            IdentityNumber = NextIsraeliId(rng, usedIds),
            FirstName = first,
            LastName = last,
            Gender = male ? "ז" : "נ",
            BirthDate = birth,
            City = city,
            Street = Streets[rng.Next(Streets.Length)],
            HouseNumber = rng.Next(1, 120).ToString(),
            PhoneMobile = "05" + rng.Next(0, 9) + rng.Next(1000000, 9999999),
            HealthFund = HealthFunds[rng.Next(HealthFunds.Length)],
            IsConfidential = rng.Next(40) == 0,
            IsBlocked = rng.Next(60) == 0,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
    }

    private void AddHistoricalVisit(
        Patient p, Random rng, DateOnly today, string[] drugs,
        Dictionary<string, List<User>> doctorsByDept, Dictionary<string, List<User>> nursesByDept,
        List<Visit> visits, List<MedicalForm> forms)
    {
        var dept = WeightedDept(rng);
        var date = today.AddDays(-rng.Next(1, 90)); // strictly before today's queue day
        var time = new TimeOnly(rng.Next(7, 23), rng.Next(0, 60));
        var status = rng.Next(100) < 85 ? VisitStatus.Discharged : VisitStatus.FinishedTreatment;
        var dt = date.ToDateTime(time);
        // All historical visits have ended → give them a realistic length-of-stay so the
        // analytics census chart has data. (Right-skewed: most short, a few long.)
        var lengthOfStayMin = 25 + rng.Next(0, 60) + rng.Next(0, 160);
        var departed = dt.AddMinutes(lengthOfStayMin);

        var visit = new Visit
        {
            PatientId = p.Id,
            Status = status,
            ReceptionDepartment = dept,
            AdmissionDate = date,
            AdmissionTime = time,
            AdmissionReason = AdmissionReasons[rng.Next(AdmissionReasons.Length)],
            CreatedAt = dt.ToUniversalTime(),
            UpdatedAt = departed.ToUniversalTime(),
            DepartedAt = departed.ToUniversalTime(),
        };
        visits.Add(visit);
        forms.Add(BuildForm(visit, dept, dt, rng, drugs, doctorsByDept, nursesByDept, signed: true));
    }

    private MedicalForm BuildForm(
        Visit visit, string dept, DateTime when, Random rng, string[] drugs,
        Dictionary<string, List<User>> doctorsByDept, Dictionary<string, List<User>> nursesByDept,
        bool signed)
    {
        var doctor = Pick(doctorsByDept, dept, rng);
        var nurse = Pick(nursesByDept, dept, rng);
        var date = DateOnly.FromDateTime(when);
        var time = TimeOnly.FromDateTime(when);

        var vitals = new[]
        {
            new
            {
                date = date.ToString("yyyy-MM-dd"), time = time.ToString("HH:mm"),
                bp = $"{rng.Next(105, 145)}/{rng.Next(65, 95)}", pulse = rng.Next(58, 105).ToString(),
                respiration = rng.Next(12, 22).ToString(), o2Sat = rng.Next(94, 100).ToString(),
                temperature = Math.Round(36.2 + rng.NextDouble() * 2.4, 1).ToString("0.0"),
                glucose = rng.Next(80, 140).ToString(), weight = rng.Next(15, 95).ToString(), notes = "",
            }
        };
        var diagnosis = Diagnoses[rng.Next(Diagnoses.Length)];
        var diagnoses = new[]
        {
            new
            {
                diagnosis, startDate = date.ToString("yyyy-MM-dd"), endDate = "",
                status = "פעיל", isPrimary = true, location = "", severity = "בינוני", notes = "",
            }
        };
        var treatments = new[]
        {
            new
            {
                drugName = drugs[rng.Next(drugs.Length)], dosage = $"{rng.Next(1, 3)} כדורים",
                startDate = date.ToString("yyyy-MM-dd"), duration = $"{rng.Next(3, 8)} ימים", notes = "",
            }
        };
        var dischargeMeds = new[]
        {
            new { drugName = drugs[rng.Next(drugs.Length)], dosage = "לפי הצורך", notes = "" }
        };

        var nurseName = nurse?.FullName ?? "צוות סיעוד";
        var doctorName = doctor?.FullName ?? "רופא תורן";
        var nurseId = nurse?.Id ?? Guid.Empty;
        var doctorId = doctor?.Id ?? Guid.Empty;
        var atEarly = when.AddMinutes(rng.Next(5, 25)).ToUniversalTime();
        var atLate = when.AddMinutes(rng.Next(30, 90)).ToUniversalTime();

        var fieldEdits = new Dictionary<string, object>
        {
            ["triage"] = new { userId = nurseId, userName = nurseName, at = atEarly },
            ["vitalSigns"] = new { userId = nurseId, userName = nurseName, at = atEarly },
            ["discussionAndPlan"] = new { userId = doctorId, userName = doctorName, at = atLate },
            ["diagnoses"] = new { userId = doctorId, userName = doctorName, at = atLate },
        };

        var form = new MedicalForm
        {
            VisitId = visit.Id,
            StationType = dept,
            FormType = "טופס מלר\"ד",
            Version = signed ? 3 : 2,
            ChiefComplaint = ChiefComplaints[rng.Next(ChiefComplaints.Length)],
            Triage = Triages[rng.Next(Triages.Length)],
            PhysicalExam = "בבדיקה: מצב כללי טוב, יציב המודינמית. ריאות נקיות, בטן רכה ולא רגישה.",
            DiscussionAndPlan = $"אבחנה: {diagnosis}. ניתן טיפול תומך והודרכה משפחה. מעקב לפי הצורך.",
            DischargeRecommendations = "מנוחה, שתייה מרובה, ומעקב רופא משפחה. לחזור במידה והתסמינים מחמירים.",
            VitalSignsJson = JsonSerializer.Serialize(vitals, Json),
            DiagnosesJson = JsonSerializer.Serialize(diagnoses, Json),
            TreatmentsJson = JsonSerializer.Serialize(treatments, Json),
            DischargeMedicationsJson = JsonSerializer.Serialize(dischargeMeds, Json),
            FieldEditsJson = JsonSerializer.Serialize(fieldEdits, Json),
            CreatedByUserId = nurseId,
            CreatedAt = when.ToUniversalTime(),
            UpdatedByUserId = doctorId,
            UpdatedAt = atLate,
        };
        // ~1 in 12 signed forms carries an allergy note, for realism.
        if (rng.Next(12) == 0)
            form.AllergiesJson = JsonSerializer.Serialize(new[]
            {
                new { drugName = "פניצילין", type = "תרופה", effect = "פריחה", determinationDate = "" }
            }, Json);

        if (signed)
        {
            var signedAt = when.AddMinutes(rng.Next(60, 150));
            form.IsSigned = true;
            form.SignedByUserId = doctorId;
            form.SignedByName = doctorName;
            form.SignedAt = signedAt.ToUniversalTime();

            // ~1 in 14 signed forms gets a post-signature addendum (separately signed).
            if (rng.Next(14) == 0)
            {
                var add = new Addendum(
                    Guid.NewGuid(), "תוספת: התקבלה תשובת מעבדה תקינה. אין שינוי בהמלצות.",
                    doctorId, doctorName, signedAt.AddHours(2).ToUniversalTime(),
                    true, doctorId, doctorName, signedAt.AddHours(2).AddMinutes(3).ToUniversalTime());
                form.AddendaJson = JsonSerializer.Serialize(new[] { add }, Json);
            }
        }
        return form;
    }

    private void SeedFeedback(Random rng, List<User> users)
    {
        var samples = new (string Screen, string Field, FeedbackType Type, string Desc)[]
        {
            ("קבלה", "תעודת זהות", FeedbackType.Bug, "לפעמים שדה ת\"ז לא מתאפס בין מטופלים."),
            ("תור", "כללי", FeedbackType.Improvement, "אפשר להוסיף צליל התראה כשמגיע מטופל חדש לתור."),
            ("טופס טיפול", "מדדים חיוניים", FeedbackType.FixNeeded, "כדאי שהטמפרטורה תסמן באדום מעל 38."),
            ("היסטוריית מטופלים", "כללי", FeedbackType.Improvement, "ייצוא תוצאות החיפוש לאקסל יעזור מאוד."),
            ("כללי", "כללי", FeedbackType.Other, "המערכת נוחה מאוד, כל הכבוד לצוות."),
        };
        foreach (var s in samples)
        {
            var u = users[rng.Next(users.Count)];
            db.FeedbackReports.Add(new FeedbackReport
            {
                Screen = s.Screen,
                FieldName = s.Field,
                ReportType = s.Type,
                Description = s.Desc,
                Status = FeedbackStatus.New,
                CreatedByUserId = u.Id,
                CreatedByName = u.FullName,
                CreatedAt = DateTime.UtcNow.AddDays(-rng.Next(1, 20)),
            });
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    private static VisitStatus LiveStatus(Random rng) => rng.Next(100) switch
    {
        < 28 => VisitStatus.Waiting,
        < 40 => VisitStatus.Called,
        < 72 => VisitStatus.InTreatment,
        < 85 => VisitStatus.FinishedTreatment,
        _ => VisitStatus.Discharged,
    };

    private static string WeightedDept(Random rng) => rng.Next(100) switch
    {
        < 50 => "רפואה דחופה",
        < 80 => "ילדים",
        _ => "נשים",
    };

    private static User? Pick(Dictionary<string, List<User>> byDept, string dept, Random rng)
    {
        if (byDept.TryGetValue(dept, out var list) && list.Count > 0) return list[rng.Next(list.Count)];
        var any = byDept.Values.FirstOrDefault(l => l.Count > 0);
        return any?[rng.Next(any.Count)];
    }

    private async Task<string[]> LoadDrugNamesAsync()
    {
        var names = await db.Medications.Where(m => m.IsActive)
            .OrderBy(m => m.Id).Select(m => m.HebrewName).Take(400).ToArrayAsync();
        return names.Length > 0 ? names : FallbackDrugs;
    }

    // Generates a valid 9-digit Israeli ID (correct check digit), unique within the run.
    private static string NextIsraeliId(Random rng, HashSet<string> used)
    {
        while (true)
        {
            var d = new int[9];
            for (int i = 0; i < 8; i++) d[i] = rng.Next(0, 10);
            int sum = 0;
            for (int i = 0; i < 8; i++)
            {
                int val = d[i] * ((i % 2) + 1);
                if (val > 9) val -= 9;
                sum += val;
            }
            d[8] = (10 - (sum % 10)) % 10;
            var id = string.Concat(d);
            if (used.Add(id)) return id;
        }
    }

    // Mirror of VisitService's queue-day logic (reset hour, Israel time).
    private async Task<DateOnly> CurrentQueueDateAsync()
    {
        var now = IsraelNow();
        var resetHour = await settings.GetIntAsync(SettingsService.QueueResetHourKey, 18);
        var effective = now.Hour < resetHour ? now.Date.AddDays(-1) : now.Date;
        return DateOnly.FromDateTime(effective);
    }
}
