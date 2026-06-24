using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace YadSarah.Domain.Entities;

// A user's professional classification(s) = their permission role(s). Multi-valued:
// one user may hold several (e.g. Nurse + Reception) and gets the UNION of permissions.
// Order is load-bearing — values persist as ints, so NEW values are appended at the end
// and existing ones are never reordered.
//   0 Reception, 1 Nurse, 2 Doctor, 3 Admin, 4 ShiftManager,
//   5 MedStudent, 6 NursingStudent, 7 LabStaff
public enum UserRole
{
    Reception, Nurse, Doctor, Admin, ShiftManager,
    MedStudent, NursingStudent, LabStaff,
}

public static class RolePriority
{
    // Higher = more privileged. Used to pick a single "primary" role for display defaults
    // (a doctor's form view differs from a nurse's) and for places that need one role.
    public static int Of(UserRole r) => r switch
    {
        UserRole.Admin => 100,
        UserRole.ShiftManager => 90,
        UserRole.Doctor => 80,
        UserRole.Nurse => 70,
        UserRole.Reception => 60,
        UserRole.MedStudent => 50,
        UserRole.NursingStudent => 40,
        UserRole.LabStaff => 30,
        _ => 0,
    };

    public static UserRole Primary(IReadOnlyCollection<UserRole> roles) =>
        roles.Count == 0 ? UserRole.Reception : roles.OrderByDescending(Of).First();
}

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Username { get; set; } = string.Empty;

    [JsonIgnore]
    public string PasswordHash { get; set; } = string.Empty;

    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    // Defaults to "FirstName LastName" but the admin may override it.
    public string? DisplayName { get; set; }

    // Professional classification(s) = permission role(s); union of permissions applies.
    public List<UserRole> Roles { get; set; } = new();

    // Highest-privilege role, for display defaults / single-role needs. Not persisted.
    [NotMapped]
    public UserRole PrimaryRole => RolePriority.Primary(Roles);

    public bool IsActive { get; set; } = true;

    // Profile fields
    public string? IdentityNumber { get; set; }
    public string? Gender { get; set; }
    public string? Title { get; set; }              // ד"ר / פרופ' / מר / גב' / (blank)
    public string? LicenseNumber { get; set; }      // medical license number
    public string? SpecialistLicenseNumber { get; set; } // מספר רישיון מומחה (מרמ)
    public string? EmployeeNumber { get; set; }
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? Department { get; set; }

    // Legacy profile columns — no longer surfaced in the user form, kept for back-compat.
    public DateOnly? DateOfBirth { get; set; }
    public string? Phone { get; set; }
    public string? PrimaryJobTitle { get; set; }
    public string? SecondaryJobTitle { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? ZipCode { get; set; }
    public string? Country { get; set; }
    public string? Notes { get; set; }

    // Account management
    public DateTime? AccountExpiresAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public int LoginFailureCount { get; set; } = 0;
    // When set and in the future, login is blocked (brute-force lockout)
    public DateTime? LockoutEndAt { get; set; }

    // Token-invalidation stamp. Emitted as the "stamp" claim at token issuance and re-checked on
    // every authenticated request (Program.cs OnTokenValidated). Rotating it (on deactivate,
    // lockout, role change, or password reset) immediately invalidates all previously-issued JWTs
    // for this user — the server-side revocation the bearer-token model otherwise lacks.
    [JsonIgnore]
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N");

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
