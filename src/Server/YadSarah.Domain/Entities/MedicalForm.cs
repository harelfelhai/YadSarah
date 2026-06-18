using System.Text.Json;

namespace YadSarah.Domain.Entities;

public class MedicalForm
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid VisitId { get; set; }
    public Visit? Visit { get; set; }

    public string StationType { get; set; } = string.Empty;
    public string FormType { get; set; } = string.Empty;

    // Optimistic concurrency version
    public int Version { get; set; } = 1;

    // Text sections (stored as columns for query-ability)
    public string? ChiefComplaint { get; set; }
    public string? PresentIllness { get; set; }
    public string? PastMedicalHistory { get; set; }
    public string? Triage { get; set; }
    public string? PhysicalExam { get; set; }
    public string? DiscussionAndPlan { get; set; }
    public string? DischargeRecommendations { get; set; }
    public string? OrderedUnits { get; set; }

    // Table sections stored as JSON (structure defined in the application layer)
    // Allergies: [{drugName, type, effect, determinationDate}]
    public string AllergiesJson { get; set; } = "[]";
    // VitalSigns: [{date, time, bp, pulse, respiration, o2Sat, temperature, glucose, weight, notes}]
    public string VitalSignsJson { get; set; } = "[]";
    // Treatments: [{drugName, dosage, startDate, duration, notes}]
    public string TreatmentsJson { get; set; } = "[]";
    // AdminOrders: [{drugName, dosage, startDate, duration, notes}]
    public string AdministrationOrdersJson { get; set; } = "[]";
    // Diagnoses: [{diagnosis, startDate, endDate, status, isPrimary, location, severity, notes}]
    public string DiagnosesJson { get; set; } = "[]";
    // DischargeMedications: [{drugName, dosage, notes}]
    public string DischargeMedicationsJson { get; set; } = "[]";
    // Routing: [{station, status, arrivalDate}]
    public string RoutingJson { get; set; } = "[]";

    // ── Signing (doctor finalizes the form → ends treatment) ──────────────────
    public bool IsSigned { get; set; }
    public Guid? SignedByUserId { get; set; }
    public string? SignedByName { get; set; }
    // Prescriber license, snapshotted at signing time (a prescription is a legal
    // document — the license as it was when signed is what matters).
    public string? SignedByLicense { get; set; }
    public string? SignedBySpecialistLicense { get; set; }
    public DateTime? SignedAt { get; set; }

    // Per-field last-editor tracking: { sectionKey: { userId, userName, at } }
    public string FieldEditsJson { get; set; } = "{}";

    // Post-signature addenda (chained appendices, each separately signed):
    // [{ id, text, createdByUserId, createdByName, createdAt, isSigned, signedByUserId, signedByName, signedAt }]
    public string AddendaJson { get; set; } = "[]";

    // Audit
    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedByUserId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// Stored inside FieldEditsJson (one entry per section key)
public record FieldEdit(Guid UserId, string UserName, DateTime At);

// Stored inside AddendaJson
public record Addendum(
    Guid Id,
    string Text,
    Guid CreatedByUserId,
    string CreatedByName,
    DateTime CreatedAt,
    bool IsSigned,
    Guid? SignedByUserId,
    string? SignedByName,
    DateTime? SignedAt);
