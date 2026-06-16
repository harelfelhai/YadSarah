using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public enum LoginOutcome { Success, InvalidCredentials, LockedOut, Expired, Inactive }

public record LoginResult(LoginOutcome Outcome, string? Token = null, User? User = null, DateTime? ExpiresAt = null);

public class AuthService(AppDbContext db, IConfiguration config)
{
    // Brute-force lockout policy: 5 failures → 15-minute lockout (admin can reset).
    private const int MaxFailedAttempts = 5;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    private TimeSpan TokenLifetime =>
        TimeSpan.FromHours(config.GetValue("Jwt:AccessTokenHours", 12));

    public async Task<LoginResult> LoginAsync(string username, string password)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == username);

        // Generic outcome when user is unknown — do not reveal account existence.
        if (user is null)
            return new LoginResult(LoginOutcome.InvalidCredentials);

        if (!user.IsActive)
            return new LoginResult(LoginOutcome.Inactive);

        if (user.LockoutEndAt.HasValue && user.LockoutEndAt.Value > DateTime.UtcNow)
            return new LoginResult(LoginOutcome.LockedOut);

        if (user.AccountExpiresAt.HasValue && user.AccountExpiresAt.Value < DateTime.UtcNow)
            return new LoginResult(LoginOutcome.Expired);

        if (!BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
        {
            user.LoginFailureCount++;
            if (user.LoginFailureCount >= MaxFailedAttempts)
            {
                user.LockoutEndAt = DateTime.UtcNow.Add(LockoutDuration);
                user.LoginFailureCount = 0; // reset counter once locked
            }
            await db.SaveChangesAsync();
            return user.LockoutEndAt.HasValue && user.LockoutEndAt.Value > DateTime.UtcNow
                ? new LoginResult(LoginOutcome.LockedOut)
                : new LoginResult(LoginOutcome.InvalidCredentials);
        }

        // Success — clear counters and lockout
        user.LastLoginAt = DateTime.UtcNow;
        user.LoginFailureCount = 0;
        user.LockoutEndAt = null;
        await db.SaveChangesAsync();

        var expiresAt = DateTime.UtcNow.Add(TokenLifetime);
        return new LoginResult(LoginOutcome.Success, GenerateToken(user), user, expiresAt);
    }

    /// <summary>
    /// Re-authentication for high-assurance actions (e.g. signing a medical form).
    /// Verifies username+password against the stored hash WITHOUT issuing a token.
    /// Returns the user only when active, not locked-out and not expired; otherwise null.
    /// Intentionally does NOT increment the brute-force counter or lock the account —
    /// a wrong password at signing must not lock a clinician out mid-shift (the endpoint
    /// is rate-limited instead). An already-locked account still cannot be used to sign.
    /// </summary>
    public async Task<User?> VerifyCredentialsAsync(string username, string password)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (user is null || !user.IsActive) return null;
        if (user.LockoutEndAt.HasValue && user.LockoutEndAt.Value > DateTime.UtcNow) return null;
        if (user.AccountExpiresAt.HasValue && user.AccountExpiresAt.Value < DateTime.UtcNow) return null;
        if (!BCrypt.Net.BCrypt.Verify(password, user.PasswordHash)) return null;
        return user;
    }

    public string HashPassword(string password) =>
        BCrypt.Net.BCrypt.HashPassword(password, workFactor: 12);

    private string GenerateToken(User user)
    {
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(config["Jwt:Secret"]
                ?? throw new InvalidOperationException("Jwt:Secret not configured")));

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.UniqueName, user.Username),
            new Claim("fullName", user.FullName),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };

        var token = new JwtSecurityToken(
            issuer: config["Jwt:Issuer"] ?? "YadSarah",
            audience: config["Jwt:Audience"] ?? "YadSarahClient",
            claims: claims,
            expires: DateTime.UtcNow.Add(TokenLifetime),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
