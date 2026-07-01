using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Api.Infrastructure;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Controllers;

/// <summary>
/// Admin board over captured runtime errors (client crashes + unhandled server exceptions).
///
/// Unlike <see cref="FeedbackController"/>, error reports are PHI-CAPABLE (a message/stack can
/// incidentally contain patient identifiers), so — like any PHI access — every read and status
/// change is written to the clinical audit log.
/// </summary>
[ApiController]
[Route("api/error-reports")]
[Authorize(Roles = "Admin")]
public class ErrorReportController(ErrorReportService svc, AuditService audit) : ControllerBase
{
    private Guid UserId =>
        User.TryGetUserId() ?? throw new InvalidOperationException("Authenticated request has no user id.");

    private static object Map(ErrorReport r) => new
    {
        id = r.Id,
        source = r.Source.ToString(),
        severity = r.Severity.ToString(),
        status = r.Status.ToString(),
        correlationId = r.CorrelationId,
        message = r.Message,
        stack = r.Stack,
        componentStack = r.ComponentStack,
        routeUrl = r.RouteUrl,
        userAgent = r.UserAgent,
        userName = r.UserName,
        userRole = r.UserRole,
        ipAddress = r.IpAddress,
        occurrenceCount = r.OccurrenceCount,
        firstSeenAt = r.FirstSeenAt,
        lastSeenAt = r.LastSeenAt,
        adminNotes = r.AdminNotes,
        updatedAt = r.UpdatedAt,
    };

    // GET /api/error-reports — filtered + paged (Admin only). PHI-capable → audited.
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] ErrorSource? source, [FromQuery] ErrorSeverity? severity,
        [FromQuery] ErrorStatus? status, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] int page = 0, [FromQuery] int pageSize = 100)
    {
        var result = await svc.GetForAdminAsync(source, severity, status, from, to, page, pageSize);
        await audit.LogAsync(AuditService.Viewed, "ErrorReport");
        return Ok(new
        {
            items = result.Items.Select(Map),
            total = result.Total,
            page = result.Page,
            pageSize = result.PageSize,
        });
    }

    // PUT /api/error-reports/{id} — triage status + notes (Admin only). Audited.
    [HttpPut("{id:long}")]
    public async Task<IActionResult> UpdateStatus(long id, [FromBody] UpdateErrorStatusRequest req)
    {
        try
        {
            var report = await svc.UpdateStatusAsync(id, req.Status, req.AdminNotes, UserId);
            // AuditLog.EntityId is a Guid; carry the long id in the text fields instead.
            await audit.LogAsync(AuditService.StatusChanged, "ErrorReport",
                fieldName: $"ErrorReport#{id}", newValue: req.Status.ToString());
            return Ok(Map(report));
        }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    public record UpdateErrorStatusRequest(
        ErrorStatus Status,
        [StringLength(4000)] string? AdminNotes);
}
