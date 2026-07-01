using System.Security.Claims;

namespace YadSarah.Api.Infrastructure;

/// <summary>Shared claim readers so the JWT claim names live in one place.</summary>
public static class ClaimsPrincipalExtensions
{
    /// <summary>The signed-in user's id, or null when anonymous / unparsable.</summary>
    public static Guid? TryGetUserId(this ClaimsPrincipal? user)
    {
        var raw = user?.FindFirstValue(ClaimTypes.NameIdentifier) ?? user?.FindFirstValue("sub");
        return Guid.TryParse(raw, out var id) ? id : null;
    }
}
