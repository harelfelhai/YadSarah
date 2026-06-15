using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>
/// Append-only audit trail of access to and changes of PHI and security events,
/// as required for a "high security level" medical database (Privacy Protection
/// (Data Security) Regulations 2017, §10). Records who/what/when/where.
/// </summary>
public class AuditService(AppDbContext db, IHttpContextAccessor http)
{
    // Common action verbs
    public const string Viewed = "Viewed";
    public const string Searched = "Searched";
    public const string Created = "Created";
    public const string Updated = "Updated";
    public const string StatusChanged = "StatusChanged";
    public const string Signed = "Signed";
    public const string Login = "Login";
    public const string LoginFailed = "LoginFailed";
    public const string LockedOut = "LockedOut";

    // Uses the current authenticated user from the request context.
    public Task LogAsync(string action, string entityType, Guid entityId = default,
        string? fieldName = null, string? oldValue = null, string? newValue = null)
    {
        var user = http.HttpContext?.User;
        var userId = TryGetUserId(user);
        var userName = user?.FindFirstValue("fullName") ?? user?.Identity?.Name ?? "system";
        return WriteAsync(userId, userName, action, entityType, entityId, fieldName, oldValue, newValue);
    }

    // Explicit identity — used for auth events where claims aren't established yet.
    public Task LogAsync(Guid userId, string userName, string action, string entityType,
        Guid entityId = default, string? newValue = null)
        => WriteAsync(userId, userName, action, entityType, entityId, null, null, newValue);

    private async Task WriteAsync(Guid userId, string userName, string action, string entityType,
        Guid entityId, string? fieldName, string? oldValue, string? newValue)
    {
        db.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            UserName = userName,
            EntityType = entityType,
            EntityId = entityId,
            Action = action,
            FieldName = fieldName,
            OldValue = Truncate(oldValue),
            NewValue = Truncate(newValue),
            Timestamp = DateTime.UtcNow,
            IpAddress = http.HttpContext?.Connection.RemoteIpAddress?.ToString(),
        });
        await db.SaveChangesAsync();
    }

    public async Task<List<AuditLog>> GetRecentAsync(string? entityType, Guid? userId, int take)
    {
        var q = db.AuditLogs.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(entityType)) q = q.Where(a => a.EntityType == entityType);
        if (userId.HasValue) q = q.Where(a => a.UserId == userId.Value);
        return await q.OrderByDescending(a => a.Timestamp).Take(Math.Clamp(take, 1, 500)).ToListAsync();
    }

    private static Guid TryGetUserId(ClaimsPrincipal? user)
    {
        var raw = user?.FindFirstValue(ClaimTypes.NameIdentifier) ?? user?.FindFirstValue("sub");
        return Guid.TryParse(raw, out var id) ? id : Guid.Empty;
    }

    // Avoid storing oversized PHI blobs in the trail
    private static string? Truncate(string? s) =>
        s is { Length: > 1000 } ? s[..1000] : s;
}
