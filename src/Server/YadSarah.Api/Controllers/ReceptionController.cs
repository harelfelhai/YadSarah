using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Controllers;

/// <summary>
/// Reception-screen infrastructure: AI department routing and the shift-manager
/// authorization gate for applying a discount/exemption. (The visit itself is still
/// created via <c>POST /api/visits</c>.)
/// </summary>
[ApiController]
[Route("api/reception")]
[Authorize(Roles = "Reception,ShiftManager,Admin")]
public class ReceptionController(
    DepartmentRoutingService routing, AuthService auth, AuditService audit) : ControllerBase
{
    // POST /api/reception/route-department — decide the department from the admission reason.
    // Returns one department (confident) or several candidates (low confidence → reception picks).
    [HttpPost("route-department")]
    public async Task<IActionResult> RouteDepartment([FromBody] RouteDepartmentRequest req, CancellationToken ct)
    {
        // Data minimization: the admission reason is now free text and leaves to an external LLM.
        // Bound it to the persisted field length (200) so nothing larger is ever sent off-box.
        var reason = req.AdmissionReason;
        if (reason is { Length: > 200 }) reason = reason[..200];

        var result = await routing.RouteAsync(
            reason, new RoutingContext(req.Age, req.Gender), ct);
        return Ok(new
        {
            departments = result.Departments,
            confidence = result.Confidence,
            source = result.Source,
            assigned = result.Assigned,
            assignedByAi = result.Source == "ai" && result.IsConfident,
        });
    }

    // POST /api/reception/authorize-discount — verify a shift-manager credential so reception
    // may unlock the discount/exemption field. A manager can authorize even while reception is
    // logged in (unlike signing, which must be the same user). Re-verified again at visit create.
    [HttpPost("authorize-discount")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> AuthorizeDiscount([FromBody] ManagerAuthRequest req)
    {
        var user = await auth.VerifyCredentialsAsync(req.Username, req.Password);
        var ok = user is not null &&
                 (user.Roles.Contains(UserRole.ShiftManager) || user.Roles.Contains(UserRole.Admin));
        if (!ok)
        {
            await audit.LogAsync("DiscountAuthFailed", "Visit", default, fieldName: "discount");
            return StatusCode(403, new { message = "נדרשת הרשאת מנהל משמרת תקפה." });
        }

        await audit.LogAsync("DiscountAuthorized", "Visit", default, fieldName: "discount",
            newValue: user!.Username);
        return Ok(new { approvedByName = user.DisplayName ?? user.FullName });
    }

    public record RouteDepartmentRequest(string? AdmissionReason, int? Age, string? Gender);
    public record ManagerAuthRequest(string Username, string Password);
}
