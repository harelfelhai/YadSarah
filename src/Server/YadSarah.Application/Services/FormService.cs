using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public class FormService(AppDbContext db, MedicationCatalogService medCatalog, DiagnosisCatalogService diagCatalog)
{
    private static readonly TimeSpan LockTtl = TimeSpan.FromMinutes(5);

    // Sections whose rows must reference a CLOSED catalog, and the row property that
    // carries the catalog value. Diagnoses → diagnosis catalog; the three drug sections
    // → medication catalog. Enforced in UpdateSectionAsync (with grandfathering).
    private static readonly Dictionary<string, string> CatalogSectionProperty = new()
    {
        ["treatments"] = "drugName",
        ["administrationOrders"] = "drugName",
        ["dischargeMedications"] = "drugName",
        ["diagnoses"] = "diagnosis",
    };

    // Window after signing during which a shift manager / admin may still fix the form.
    // (Configurable — client said this may change later.)
    public static readonly TimeSpan PostSignEditWindow = TimeSpan.FromMinutes(10);

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    // Sections shared across all of a visit's forms (a dual women's + other-dept visit has two).
    // They are objective / patient-level data captured once, so an edit on one form mirrors to the
    // siblings. Matches the client decision (vitals + allergies + past medical history).
    private static readonly HashSet<string> SharedSections = new() { "vitalSigns", "allergies", "pastMedicalHistory" };

    public async Task<List<MedicalForm>> GetByVisitAsync(Guid visitId) =>
        await db.MedicalForms.Where(f => f.VisitId == visitId).ToListAsync();

    public async Task<MedicalForm?> GetByIdAsync(Guid id) =>
        await db.MedicalForms.FindAsync(id);

    public async Task<MedicalForm> CreateAsync(MedicalForm form)
    {
        db.MedicalForms.Add(form);
        await db.SaveChangesAsync();
        return form;
    }

    public async Task<MedicalForm> UpdateSectionAsync(
        Guid formId, string section, string jsonOrText, int expectedVersion,
        Guid userId, string userName, IReadOnlyCollection<UserRole> roles)
    {
        var form = await db.MedicalForms.FindAsync(formId)
            ?? throw new KeyNotFoundException($"Form {formId} not found");

        // Role-based field permission (union across the user's roles)
        if (!FormSectionPolicy.CanEdit(roles, section))
            throw new ForbiddenException("אין לך הרשאה לערוך שדה זה.");

        // Signed forms are locked — except a shift manager / admin within the grace window
        if (form.IsSigned)
        {
            var canOverride =
                (roles.Contains(UserRole.ShiftManager) || roles.Contains(UserRole.Admin)) &&
                form.SignedAt.HasValue &&
                DateTime.UtcNow <= form.SignedAt.Value.Add(PostSignEditWindow);
            if (!canOverride)
                throw new FormSignedException("הטופס חתום ונעול לעריכה.");
        }

        if (form.Version != expectedVersion)
            throw new ConcurrencyException("הטופס עודכן ע\"י משתמש אחר. רענן ונסה שוב.");

        // Closed-list enforcement: a diagnosis / drug must come from the catalog.
        // Grandfathered: values already stored in this section are allowed (legacy/free-text
        // data never blocks an edit); skipped entirely while the catalog is unpopulated.
        await ValidateCatalogSectionAsync(form, section, jsonOrText);

        SetSection(form, section, jsonOrText);
        RecordFieldEdit(form, section, userId, userName);
        form.Version++;
        form.UpdatedAt = DateTime.UtcNow;
        form.UpdatedByUserId = userId;

        // Shared sections (vitals/allergies/past history) mirror to the visit's other forms,
        // so a dual women's + other-dept visit keeps one set of objective data. Signed siblings
        // are skipped — their clinical record is already finalized.
        if (SharedSections.Contains(section))
        {
            var siblings = await db.MedicalForms
                .Where(f => f.VisitId == form.VisitId && f.Id != form.Id && !f.IsSigned)
                .ToListAsync();
            foreach (var sib in siblings)
            {
                SetSection(sib, section, jsonOrText);
                RecordFieldEdit(sib, section, userId, userName);
                sib.Version++;
                sib.UpdatedAt = DateTime.UtcNow;
                sib.UpdatedByUserId = userId;
            }
        }

        await db.SaveChangesAsync();
        return form;
    }

    // ── Signing ───────────────────────────────────────────────────────────

    public async Task<MedicalForm> SignAsync(Guid formId, Guid userId, string userName, IReadOnlyCollection<UserRole> roles)
    {
        if (!roles.Contains(UserRole.Doctor))
            throw new ForbiddenException("רק רופא יכול לחתום על הטופס ולסיים את הטיפול.");

        var form = await db.MedicalForms.FindAsync(formId)
            ?? throw new KeyNotFoundException($"Form {formId} not found");

        if (form.IsSigned)
            throw new FormSignedException("הטופס כבר חתום.");

        // Snapshot the prescriber's license for the printed prescription / discharge letter.
        var signer = await db.Users.FindAsync(userId);

        form.IsSigned = true;
        form.SignedByUserId = userId;
        form.SignedByName = userName;
        form.SignedByLicense = signer?.LicenseNumber;
        form.SignedBySpecialistLicense = signer?.SpecialistLicenseNumber;
        form.SignedAt = DateTime.UtcNow;
        form.Version++;
        form.UpdatedAt = DateTime.UtcNow;
        form.UpdatedByUserId = userId;

        // Signing completes THIS form's track. The patient is discharged only once EVERY form
        // is signed — a dual women's + other-dept visit runs two processes, so signing the first
        // (women's) form must not release the patient before the second. The reception discharge
        // board still serves edge cases (left without a signed form, or a manual release).
        var visit = await db.Visits
            .Include(v => v.Forms)
            .Include(v => v.CareSteps)
            .FirstOrDefaultAsync(v => v.Id == form.VisitId);
        if (visit is not null && visit.Status != VisitStatus.Discharged)
        {
            // This track's doctor finished → mark its doctor care-step(s) done. A null Department
            // (legacy / single-track form) matches every doctor step.
            foreach (var s in visit.CareSteps.Where(s =>
                s.Category == CareStepCategory.Clinician &&
                s.ClinicianRole == UserRole.Doctor &&
                (form.Department == null || s.Department == form.Department) &&
                s.Status != CareStepStatus.Done && s.Status != CareStepStatus.Canceled))
            {
                s.Status = CareStepStatus.Done;
                s.CompletedAt = DateTime.UtcNow;
                s.UpdatedAt = DateTime.UtcNow;
            }

            var allFormsSigned = visit.Forms.All(f => f.IsSigned); // current form is tracked as signed
            if (allFormsSigned)
            {
                visit.Status = VisitStatus.Discharged;
                visit.DepartedAt ??= DateTime.UtcNow; // departure instant for the analytics census chart
            }
            else
            {
                visit.Status = CareStepService.DeriveStatus(visit.CareSteps, allFormsSigned: false);
            }
            visit.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        return form;
    }

    // ── Addenda (post-signature appendices) ───────────────────────────────

    public async Task<MedicalForm> AddAddendumAsync(Guid formId, string text, Guid userId, string userName)
    {
        var form = await db.MedicalForms.FindAsync(formId)
            ?? throw new KeyNotFoundException($"Form {formId} not found");

        if (!form.IsSigned)
            throw new FormSignedException("ניתן להוסיף תוספת רק לאחר חתימת הטופס.");
        if (string.IsNullOrWhiteSpace(text))
            throw new ArgumentException("תוכן התוספת ריק.");

        var list = DeserializeAddenda(form);
        list.Add(new Addendum(
            Guid.NewGuid(), text.Trim(), userId, userName, DateTime.UtcNow,
            IsSigned: false, SignedByUserId: null, SignedByName: null, SignedAt: null));
        form.AddendaJson = JsonSerializer.Serialize(list, JsonOpts);
        form.UpdatedAt = DateTime.UtcNow;
        form.UpdatedByUserId = userId;

        await db.SaveChangesAsync();
        return form;
    }

    public async Task<MedicalForm> SignAddendumAsync(
        Guid formId, Guid addendumId, Guid userId, string userName, IReadOnlyCollection<UserRole> roles)
    {
        if (!roles.Contains(UserRole.Doctor))
            throw new ForbiddenException("רק רופא יכול לחתום על תוספת.");

        var form = await db.MedicalForms.FindAsync(formId)
            ?? throw new KeyNotFoundException($"Form {formId} not found");

        var list = DeserializeAddenda(form);
        var idx = list.FindIndex(a => a.Id == addendumId);
        if (idx < 0) throw new KeyNotFoundException("התוספת לא נמצאה.");
        if (list[idx].IsSigned) throw new FormSignedException("התוספת כבר חתומה.");

        list[idx] = list[idx] with
        {
            IsSigned = true,
            SignedByUserId = userId,
            SignedByName = userName,
            SignedAt = DateTime.UtcNow,
        };
        form.AddendaJson = JsonSerializer.Serialize(list, JsonOpts);
        form.UpdatedAt = DateTime.UtcNow;
        form.UpdatedByUserId = userId;

        await db.SaveChangesAsync();
        return form;
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private static void RecordFieldEdit(MedicalForm form, string section, Guid userId, string userName)
    {
        var edits = string.IsNullOrWhiteSpace(form.FieldEditsJson)
            ? new Dictionary<string, FieldEdit>()
            : JsonSerializer.Deserialize<Dictionary<string, FieldEdit>>(form.FieldEditsJson, JsonOpts)
              ?? new Dictionary<string, FieldEdit>();
        edits[section] = new FieldEdit(userId, userName, DateTime.UtcNow);
        form.FieldEditsJson = JsonSerializer.Serialize(edits, JsonOpts);
    }

    private static List<Addendum> DeserializeAddenda(MedicalForm form) =>
        string.IsNullOrWhiteSpace(form.AddendaJson)
            ? new List<Addendum>()
            : JsonSerializer.Deserialize<List<Addendum>>(form.AddendaJson, JsonOpts) ?? new List<Addendum>();

    // ── Locking ───────────────────────────────────────────────────────────

    public async Task<(bool acquired, string? lockedByName)> AcquireLockAsync(
        Guid formId, string section, Guid userId, string userName)
    {
        // Clean expired locks first
        var expired = db.FormLocks.Where(l => l.ExpiresAt < DateTime.UtcNow);
        db.FormLocks.RemoveRange(expired);

        var existing = await db.FormLocks
            .FirstOrDefaultAsync(l => l.FormId == formId && l.SectionName == section);

        if (existing is not null && existing.UserId != userId)
            return (false, existing.UserName);

        if (existing is not null)
        {
            existing.ExpiresAt = DateTime.UtcNow.Add(LockTtl);
        }
        else
        {
            db.FormLocks.Add(new FormLock
            {
                FormId = formId,
                SectionName = section,
                UserId = userId,
                UserName = userName,
                ExpiresAt = DateTime.UtcNow.Add(LockTtl),
            });
        }

        await db.SaveChangesAsync();
        return (true, null);
    }

    public async Task ReleaseLockAsync(Guid formId, string section, Guid userId)
    {
        var lock_ = await db.FormLocks
            .FirstOrDefaultAsync(l => l.FormId == formId && l.SectionName == section && l.UserId == userId);
        if (lock_ is not null)
        {
            db.FormLocks.Remove(lock_);
            await db.SaveChangesAsync();
        }
    }

    public async Task<List<FormLock>> GetLocksAsync(Guid formId) =>
        await db.FormLocks
            .Where(l => l.FormId == formId && l.ExpiresAt > DateTime.UtcNow)
            .ToListAsync();

    // ── Closed-list (catalog) enforcement ─────────────────────────────────

    // Rejects a save that introduces a NEW catalog value not in the closed list. Values
    // already persisted in the section are grandfathered (never block an edit), and the
    // check is skipped when the catalog is empty (an empty list can't be enforced).
    private async Task ValidateCatalogSectionAsync(MedicalForm form, string section, string newJson)
    {
        if (!CatalogSectionProperty.TryGetValue(section, out var prop)) return;

        var isDiagnoses = section == "diagnoses";
        var labels = isDiagnoses
            ? await diagCatalog.GetActiveLabelsAsync()
            : await medCatalog.GetActiveLabelsAsync();
        if (labels.Count == 0) return; // no catalog loaded → cannot enforce a closed list

        var existing = ExtractValues(GetSectionJson(form, section), prop); // grandfathered
        foreach (var v in ExtractValues(newJson, prop))
        {
            if (labels.Contains(v) || existing.Contains(v)) continue;
            var what = isDiagnoses ? "האבחנה" : "התרופה";
            throw new ArgumentException($"{what} \"{v}\" אינה מופיעה בקטלוג. יש לבחור ערך מהרשימה הסגורה.");
        }
    }

    private static string GetSectionJson(MedicalForm form, string section) => section switch
    {
        "treatments" => form.TreatmentsJson,
        "administrationOrders" => form.AdministrationOrdersJson,
        "dischargeMedications" => form.DischargeMedicationsJson,
        "diagnoses" => form.DiagnosesJson,
        _ => "[]",
    };

    // Non-empty, trimmed string values of `prop` across a JSON array of row objects.
    private static HashSet<string> ExtractValues(string? json, string prop)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(json)) return set;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return set;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (el.ValueKind != JsonValueKind.Object) continue;
                if (el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String)
                {
                    var s = v.GetString()?.Trim();
                    if (!string.IsNullOrWhiteSpace(s)) set.Add(s);
                }
            }
        }
        catch { /* malformed JSON → nothing to validate */ }
        return set;
    }

    // ── Section mapping ───────────────────────────────────────────────────

    private static void SetSection(MedicalForm form, string section, string value)
    {
        switch (section)
        {
            case "chiefComplaint": form.ChiefComplaint = value; break;
            case "presentIllness": form.PresentIllness = value; break;
            case "pastMedicalHistory": form.PastMedicalHistory = value; break;
            case "triage": form.Triage = value; break;
            case "physicalExam": form.PhysicalExam = value; break;
            case "discussionAndPlan": form.DiscussionAndPlan = value; break;
            case "dischargeRecommendations": form.DischargeRecommendations = value; break;
            case "orderedUnits": form.OrderedUnits = value; break;
            case "allergies": form.AllergiesJson = value; break;
            case "vitalSigns": form.VitalSignsJson = value; break;
            case "treatments": form.TreatmentsJson = value; break;
            case "administrationOrders": form.AdministrationOrdersJson = value; break;
            case "diagnoses": form.DiagnosesJson = value; break;
            case "dischargeMedications": form.DischargeMedicationsJson = value; break;
            case "routing": form.RoutingJson = value; break;
            default: throw new ArgumentException($"Unknown section: {section}");
        }
    }
}

public class ConcurrencyException(string message) : Exception(message);
public class ForbiddenException(string message) : Exception(message);
public class FormSignedException(string message) : Exception(message);
