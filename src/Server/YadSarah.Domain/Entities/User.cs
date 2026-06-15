using System.Text.Json.Serialization;

namespace YadSarah.Domain.Entities;

// ShiftManager (4) must stay after Admin (3) to avoid shifting existing DB int values
public enum UserRole { Reception, Nurse, Doctor, Admin, ShiftManager }

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Username { get; set; } = string.Empty;

    [JsonIgnore]
    public string PasswordHash { get; set; } = string.Empty;

    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public UserRole Role { get; set; }
    public bool IsActive { get; set; } = true;

    // Profile fields
    public string? IdentityNumber { get; set; }
    public string? Gender { get; set; }
    public DateOnly? DateOfBirth { get; set; }
    public string? Phone { get; set; }
    public string? Mobile { get; set; }
    public string? PrimaryJobTitle { get; set; }
    public string? SecondaryJobTitle { get; set; }
    public string? Department { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? ZipCode { get; set; }
    public string? Country { get; set; } = "ישראל";
    public string? Notes { get; set; }

    // Account management
    public DateTime? AccountExpiresAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public int LoginFailureCount { get; set; } = 0;
    // When set and in the future, login is blocked (brute-force lockout)
    public DateTime? LockoutEndAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
