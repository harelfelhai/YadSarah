using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public record CreateUserRequest(
    string FirstName,
    string LastName,
    string Username,
    string Password,
    List<UserRole> Roles,
    string? DisplayName,
    string? IdentityNumber,
    string? Gender,
    string? Title,
    string? LicenseNumber,
    string? SpecialistLicenseNumber,
    string? EmployeeNumber,
    string? Mobile,
    string? Email,
    string? Department,
    string? Station
);

public record UpdateUserRequest(
    string FirstName,
    string LastName,
    string Username,
    List<UserRole> Roles,
    bool IsActive,
    string? NewPassword,
    string? DisplayName,
    string? IdentityNumber,
    string? Gender,
    string? Title,
    string? LicenseNumber,
    string? SpecialistLicenseNumber,
    string? EmployeeNumber,
    string? Mobile,
    string? Email,
    string? Department,
    string? Station
);

public class UserService(AppDbContext db, AuthService auth)
{
    public async Task<List<User>> GetAllAsync() =>
        await db.Users.OrderBy(u => u.LastName).ThenBy(u => u.FirstName).ToListAsync();

    public async Task<User?> GetByIdAsync(Guid id) =>
        await db.Users.FindAsync(id);

    // Reject angle-bracket / HTML characters in names. These names surface as the
    // treating-staff name on the queue/board and as editor/signer names in history;
    // keeping markup out of them is defense in depth (the React client already escapes).
    // Throws ArgumentException (→ 400) for bad *input*, distinct from the
    // InvalidOperationException used for genuine conflicts (→ 409, e.g. duplicate username).
    private static void ValidateNames(string firstName, string lastName)
    {
        if (firstName.Contains('<') || firstName.Contains('>') ||
            lastName.Contains('<') || lastName.Contains('>'))
            throw new ArgumentException("שם פרטי/משפחה אינו יכול להכיל את התווים < או >.");
    }

    private static void ValidateRoles(List<UserRole>? roles)
    {
        if (roles is null || roles.Count == 0)
            throw new ArgumentException("יש לבחור לפחות סיווג מקצועי אחד.");
    }

    // Display name defaults to "First Last" but the admin may override it.
    private static string ResolveDisplayName(string? displayName, string first, string last) =>
        string.IsNullOrWhiteSpace(displayName) ? $"{first} {last}".Trim() : displayName.Trim();

    public async Task<User> CreateAsync(CreateUserRequest req)
    {
        if (await db.Users.AnyAsync(u => u.Username == req.Username))
            throw new InvalidOperationException("שם משתמש כבר קיים במערכת");

        ValidateNames(req.FirstName, req.LastName);
        ValidateRoles(req.Roles);

        var (ok, error) = PasswordPolicy.Validate(req.Password);
        if (!ok) throw new ArgumentException(error!);

        var user = new User
        {
            FirstName = req.FirstName,
            LastName = req.LastName,
            FullName = $"{req.FirstName} {req.LastName}".Trim(),
            DisplayName = ResolveDisplayName(req.DisplayName, req.FirstName, req.LastName),
            Username = req.Username,
            PasswordHash = auth.HashPassword(req.Password),
            Roles = req.Roles,
            IdentityNumber = req.IdentityNumber,
            Gender = req.Gender,
            Title = req.Title,
            LicenseNumber = req.LicenseNumber,
            SpecialistLicenseNumber = req.SpecialistLicenseNumber,
            EmployeeNumber = req.EmployeeNumber,
            Mobile = req.Mobile,
            Email = req.Email,
            Department = req.Department,
            Station = req.Station,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    public async Task<User> UpdateAsync(Guid id, UpdateUserRequest req)
    {
        var user = await db.Users.FindAsync(id)
            ?? throw new KeyNotFoundException($"User {id} not found");

        if (req.Username != user.Username &&
            await db.Users.AnyAsync(u => u.Username == req.Username && u.Id != id))
            throw new InvalidOperationException("שם משתמש כבר קיים במערכת");

        ValidateNames(req.FirstName, req.LastName);
        ValidateRoles(req.Roles);

        // Detect security-state changes that must invalidate the user's existing JWTs: a role
        // change (permissions shift) or a deactivation. Compared BEFORE the new values are applied.
        var rolesChanged = !user.Roles.OrderBy(r => r).SequenceEqual(req.Roles.OrderBy(r => r));
        var deactivated = user.IsActive && !req.IsActive;

        user.FirstName = req.FirstName;
        user.LastName = req.LastName;
        user.FullName = $"{req.FirstName} {req.LastName}".Trim();
        user.DisplayName = ResolveDisplayName(req.DisplayName, req.FirstName, req.LastName);
        user.Username = req.Username;
        user.Roles = req.Roles;
        user.IsActive = req.IsActive;
        user.IdentityNumber = req.IdentityNumber;
        user.Gender = req.Gender;
        user.Title = req.Title;
        user.LicenseNumber = req.LicenseNumber;
        user.SpecialistLicenseNumber = req.SpecialistLicenseNumber;
        user.EmployeeNumber = req.EmployeeNumber;
        user.Mobile = req.Mobile;
        user.Email = req.Email;
        user.Department = req.Department;
        user.Station = req.Station;
        user.UpdatedAt = DateTime.UtcNow;

        var passwordReset = false;
        if (!string.IsNullOrWhiteSpace(req.NewPassword))
        {
            var (ok, error) = PasswordPolicy.Validate(req.NewPassword);
            if (!ok) throw new InvalidOperationException(error!);
            user.PasswordHash = auth.HashPassword(req.NewPassword);
            user.LoginFailureCount = 0;
            user.LockoutEndAt = null;
            passwordReset = true;
        }

        // Rotate the security stamp so any JWTs issued before this change stop working immediately
        // (Program.cs OnTokenValidated rejects a stale stamp). A plain profile edit does not revoke.
        if (rolesChanged || deactivated || passwordReset)
            user.SecurityStamp = Guid.NewGuid().ToString("N");

        await db.SaveChangesAsync();
        return user;
    }

    public async Task ResetLoginFailuresAsync(Guid id)
    {
        var user = await db.Users.FindAsync(id) ?? throw new KeyNotFoundException();
        user.LoginFailureCount = 0;
        user.LockoutEndAt = null; // unlock the account
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }
}
