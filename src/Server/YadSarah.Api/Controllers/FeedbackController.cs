using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/feedback")]
[Authorize] // any authenticated user may submit; reading/editing is Admin-only (per-action)
// Feedback is operational (non-clinical) data and is intentionally NOT written to the
// clinical audit log — it would only add noise unrelated to PHI access. Edit accountability
// is preserved on the row itself (UpdatedAt / UpdatedByUserId).
public class FeedbackController(FeedbackService svc) : ControllerBase
{
    private Guid UserId =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);
    private string UserName =>
        User.FindFirstValue("fullName") ?? User.Identity?.Name ?? "Unknown";
    private string UserRoleName =>
        User.FindFirstValue(ClaimTypes.Role) ?? "";

    private static object Map(FeedbackReport f) => new
    {
        id = f.Id,
        screen = f.Screen,
        fieldName = f.FieldName,
        reportType = f.ReportType.ToString(),
        description = f.Description,
        routeUrl = f.RouteUrl,
        status = f.Status.ToString(),
        adminNotes = f.AdminNotes,
        createdByName = f.CreatedByName,
        createdByRole = f.CreatedByRole,
        createdAt = f.CreatedAt,
        updatedAt = f.UpdatedAt,
    };

    // POST /api/feedback — submit a report (any authenticated user)
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateFeedbackRequest req)
    {
        var report = await svc.CreateAsync(
            req.Screen, req.FieldName, req.ReportType, req.Description, req.RouteUrl,
            UserId, UserName, UserRoleName);
        return Ok(Map(report));
    }

    // GET /api/feedback — list all reports (Admin only)
    [HttpGet]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> GetAll()
    {
        var reports = await svc.GetAllAsync();
        return Ok(reports.Select(Map));
    }

    // PUT /api/feedback/{id} — edit a report (Admin only)
    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateFeedbackRequest req)
    {
        try
        {
            var report = await svc.UpdateAsync(
                id, req.Status, req.AdminNotes, req.Screen, req.FieldName, req.ReportType, req.Description, UserId);
            return Ok(Map(report));
        }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    public record CreateFeedbackRequest(
        [Required, StringLength(100)] string Screen,
        [Required, StringLength(150)] string FieldName,
        FeedbackType ReportType,
        [Required, StringLength(4000, MinimumLength = 1)] string Description,
        [StringLength(500)] string? RouteUrl);

    public record UpdateFeedbackRequest(
        FeedbackStatus Status,
        [StringLength(4000)] string? AdminNotes,
        [Required, StringLength(100)] string Screen,
        [Required, StringLength(150)] string FieldName,
        FeedbackType ReportType,
        [Required, StringLength(4000, MinimumLength = 1)] string Description);
}
