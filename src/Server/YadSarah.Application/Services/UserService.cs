using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public record CreateUserRequest(
    string FirstName,
    string LastName,
    string Username,
    string Password,
    UserRole Role,
    string? IdentityNumber,
    string? Gender,
    DateOnly? DateOfBirth,
    string? Phone,
    string? Mobile,
    string? PrimaryJobTitle,
    string? SecondaryJobTitle,
    string? Department,
    string? Address,
    string? City,
    string? ZipCode,
    string? Country,
    string? Notes,
    DateTime? AccountExpiresAt
);

public record UpdateUserRequest(
    string FirstName,
    string LastName,
    string Username,
    UserRole Role,
    bool IsActive,
    string? NewPassword,
    string? IdentityNumber,
    string? Gender,
    DateOnly? DateOfBirth,
    string? Phone,
    string? Mobile,
    string? PrimaryJobTitle,
    string? SecondaryJobTitle,
    string? Department,
    string? Address,
    string? City,
    string? ZipCode,
    string? Country,
    string? Notes,
    DateTime? AccountExpiresAt
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

    public async Task<User> CreateAsync(CreateUserRequest req)
    {
        if (await db.Users.AnyAsync(u => u.Username == req.Username))
            throw new InvalidOperationException("שם משתמש כבר קיים במערכת");

        ValidateNames(req.FirstName, req.LastName);

        var (ok, error) = PasswordPolicy.Validate(req.Password);
        if (!ok) throw new ArgumentException(error!);

        var user = new User
        {
            FirstName = req.FirstName,
            LastName = req.LastName,
            FullName = $"{req.FirstName} {req.LastName}".Trim(),
            Username = req.Username,
            PasswordHash = auth.HashPassword(req.Password),
            Role = req.Role,
            IdentityNumber = req.IdentityNumber,
            Gender = req.Gender,
            DateOfBirth = req.DateOfBirth,
            Phone = req.Phone,
            Mobile = req.Mobile,
            PrimaryJobTitle = req.PrimaryJobTitle,
            SecondaryJobTitle = req.SecondaryJobTitle,
            Department = req.Department,
            Address = req.Address,
            City = req.City,
            ZipCode = req.ZipCode,
            Country = req.Country ?? "ישראל",
            Notes = req.Notes,
            AccountExpiresAt = req.AccountExpiresAt,
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

        user.FirstName = req.FirstName;
        user.LastName = req.LastName;
        user.FullName = $"{req.FirstName} {req.LastName}".Trim();
        user.Username = req.Username;
        user.Role = req.Role;
        user.IsActive = req.IsActive;
        user.IdentityNumber = req.IdentityNumber;
        user.Gender = req.Gender;
        user.DateOfBirth = req.DateOfBirth;
        user.Phone = req.Phone;
        user.Mobile = req.Mobile;
        user.PrimaryJobTitle = req.PrimaryJobTitle;
        user.SecondaryJobTitle = req.SecondaryJobTitle;
        user.Department = req.Department;
        user.Address = req.Address;
        user.City = req.City;
        user.ZipCode = req.ZipCode;
        user.Country = req.Country ?? "ישראל";
        user.Notes = req.Notes;
        user.AccountExpiresAt = req.AccountExpiresAt;
        user.UpdatedAt = DateTime.UtcNow;

        if (!string.IsNullOrWhiteSpace(req.NewPassword))
        {
            var (ok, error) = PasswordPolicy.Validate(req.NewPassword);
            if (!ok) throw new InvalidOperationException(error!);
            user.PasswordHash = auth.HashPassword(req.NewPassword);
            user.LoginFailureCount = 0;
            user.LockoutEndAt = null;
        }

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
