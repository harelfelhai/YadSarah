using System.ComponentModel.DataAnnotations;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Dtos;

/// <summary>
/// What a patient fills on the PUBLIC self-service intake page. Only patient-supplied fields —
/// NO department/routing (decided later by reception) and NO staff-only flags. The API is the
/// trust boundary: lengths are capped here and content is validated in the controller.
/// </summary>
public class PublicIntakeRequest
{
    // Identity (typed by the patient; format-validated client-side, never auto-matched on submit)
    [StringLength(50)] public string IdentityType { get; set; } = "תעודת זהות";
    [StringLength(50)] public string? IdentityNumber { get; set; }

    [Required, StringLength(100)] public string FirstName { get; set; } = string.Empty;
    [Required, StringLength(100)] public string LastName { get; set; } = string.Empty;
    [StringLength(100)] public string? FatherName { get; set; }
    [StringLength(10)] public string? Gender { get; set; }
    public DateOnly? BirthDate { get; set; }

    [StringLength(150)] public string? City { get; set; }
    [StringLength(200)] public string? Street { get; set; }
    [StringLength(20)] public string? HouseNumber { get; set; }

    [StringLength(30)] public string? PhoneMobile { get; set; }
    [StringLength(30)] public string? PhoneHome { get; set; }
    [StringLength(200)] public string? Email { get; set; }
    [StringLength(150)] public string? DigitalContactPerson { get; set; }
    [StringLength(50)] public string? DigitalContactRelation { get; set; }
    [StringLength(30)] public string? DigitalContactPhone { get; set; }
    public bool AcceptsDigitalInfo { get; set; }
    [StringLength(50)] public string? HealthFund { get; set; }

    [StringLength(200)] public string? AdmissionReason { get; set; }
    [StringLength(2000)] public string? Notes { get; set; }

    /// <summary>Browser-generated token (the "same device" key for the 3-per-device submit cap).</summary>
    [StringLength(64)] public string? DeviceId { get; set; }

    public PatientIntakeSubmission ToEntity() => new()
    {
        IdentityType = IdentityType,
        IdentityNumber = IdentityNumber,
        FirstName = FirstName,
        LastName = LastName,
        FatherName = FatherName,
        Gender = Gender,
        BirthDate = BirthDate,
        City = City,
        Street = Street,
        HouseNumber = HouseNumber,
        PhoneMobile = PhoneMobile,
        PhoneHome = PhoneHome,
        Email = Email,
        DigitalContactPerson = DigitalContactPerson,
        DigitalContactRelation = DigitalContactRelation,
        DigitalContactPhone = DigitalContactPhone,
        AcceptsDigitalInfo = AcceptsDigitalInfo,
        HealthFund = HealthFund,
        AdmissionReason = AdmissionReason,
        Notes = Notes,
        DeviceId = DeviceId,
    };
}
