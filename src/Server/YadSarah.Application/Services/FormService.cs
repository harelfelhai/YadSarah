using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public class FormService(AppDbContext db)
{
    private static readonly TimeSpan LockTtl = TimeSpan.FromMinutes(5);

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
        Guid formId, string section, string jsonOrText, int expectedVersion, Guid userId)
    {
        var form = await db.MedicalForms.FindAsync(formId)
            ?? throw new KeyNotFoundException($"Form {formId} not found");

        if (form.Version != expectedVersion)
            throw new ConcurrencyException("Form was modified by another user. Please reload.");

        SetSection(form, section, jsonOrText);
        form.Version++;
        form.UpdatedAt = DateTime.UtcNow;
        form.UpdatedByUserId = userId;

        await db.SaveChangesAsync();
        return form;
    }

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
