namespace YadSarah.Domain.Entities;

public class Patient
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // Identity
    public string IdentityType { get; set; } = string.Empty; // תעודת זהות / דרכון / זמני / ת"ז פלסטינית / יילוד / לא ידוע
    public string? IdentityNumber { get; set; }

    // Personal
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? FirstNameLatin { get; set; }
    public string? LastNameLatin { get; set; }
    public string? Gender { get; set; } // ז / נ / א
    public string? FatherName { get; set; }
    public DateOnly? BirthDate { get; set; }
    public string? BirthCountry { get; set; }
    public string? MaritalStatus { get; set; }
    public int? NumberOfChildren { get; set; }

    // Address
    public string? City { get; set; }
    public string? Street { get; set; }
    public string? HouseNumber { get; set; }
    public string? ZipCode { get; set; }
    public string? PoBox { get; set; }

    // Contact
    public string? PhoneMobile { get; set; }
    public string? PhoneHome { get; set; }
    public string? PhoneWork { get; set; }
    public string? PhoneExtra1 { get; set; }
    public string? PhoneExtra2 { get; set; }
    public string? Email { get; set; }
    public string? Fax { get; set; }
    public string? DigitalContactPerson { get; set; }
    public string? DigitalContactPhone { get; set; }
    public bool AcceptsDigitalInfo { get; set; }

    // Health fund
    public string? HealthFund { get; set; }
    public string? HealthFundBranch { get; set; }
    public string? FamilyDoctorName { get; set; }
    public string? ClinicPhone { get; set; }
    public string? ClinicFax { get; set; }
    public string? ClinicEmail { get; set; }

    // Flags
    public bool IsConfidential { get; set; }
    public bool IsBlocked { get; set; }
    public bool IsHonorBlocked { get; set; }
    public bool AccountingCard { get; set; }
    public string? Notes { get; set; }

    // Audit
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation — excluded from API binding to prevent circular reference issues
    [System.Text.Json.Serialization.JsonIgnore]
    public ICollection<Visit> Visits { get; set; } = [];
}
