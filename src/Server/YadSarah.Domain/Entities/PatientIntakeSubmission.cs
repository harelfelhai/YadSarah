namespace YadSarah.Domain.Entities;

// Numeric order must not change (EF stores enums as string, but keep stable anyway).
// Pending → triaged by reception into either Imported (used to admit) or Dismissed.
public enum IntakeStatus { Pending, Imported, Dismissed }

/// <summary>
/// A self-service intake form filled by a patient on their own device from the PUBLIC
/// (no-login) page. This is a STAGING record — deliberately NOT a <see cref="Patient"/> and
/// with NO foreign key to one: nothing here touches the patient records until reception
/// reviews it and explicitly imports it. Reception triages each row (import / dismiss) and
/// sees conflicts against an existing patient (matched by IdentityType + IdentityNumber).
/// </summary>
public class PatientIntakeSubmission
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // ── Identity (as the patient typed it; never trusted, never auto-matched on submit) ──
    public string IdentityType { get; set; } = string.Empty; // תעודת זהות / דרכון
    public string? IdentityNumber { get; set; }

    // ── Demographics (mirrors the subset of Patient the public form collects) ──
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? FatherName { get; set; }
    public string? Gender { get; set; }              // ז / נ / א
    public DateOnly? BirthDate { get; set; }

    public string? City { get; set; }
    public string? Street { get; set; }
    public string? HouseNumber { get; set; }

    public string? PhoneMobile { get; set; }
    public string? PhoneHome { get; set; }
    public string? Email { get; set; }
    public string? DigitalContactPerson { get; set; }
    public string? DigitalContactRelation { get; set; }
    public string? DigitalContactPhone { get; set; }
    public bool AcceptsDigitalInfo { get; set; }
    public string? HealthFund { get; set; }

    // ── Event (NO department / AI-routing fields — decided later by reception staff) ──
    public string? AdmissionReason { get; set; }
    public string? Notes { get; set; }

    // ── Triage / provenance ──
    public IntakeStatus Status { get; set; } = IntakeStatus.Pending;
    public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Browser-generated device token — the basis of the "3 per device" submit cap.</summary>
    public string? DeviceId { get; set; }
    public string? SourceIp { get; set; }
}
