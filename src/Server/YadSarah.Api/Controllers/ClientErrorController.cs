using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using YadSarah.Api.Middleware;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Controllers;

/// <summary>
/// PUBLIC (no-login) sink for client-side crash reports. The React root error boundary POSTs here
/// when a render exception would otherwise white-screen the app, so an operator can SEE the stack
/// trace in the server log (Render) instead of it dying silently in a user's browser console.
///
/// Security posture: anonymous (a crash on the login page must still report) but tightly bounded —
/// a dedicated per-IP rate-limit policy caps abuse, every field has a hard length cap (DTO
/// attributes reject oversized payloads), and all logged text is stripped of control characters to
/// prevent log forging. The report is written to the durable application log AND persisted as a
/// PHI-capable client-side ErrorReport for the admin board (Admin-only + audited + retention-pruned).
/// A crash message could incidentally contain PHI, so it inherits the same trust boundary as the
/// rest of the server logs (see docs/security/02-security-controls.md). Persistence is best-effort —
/// a DB failure is swallowed so it never turns the 204 into a 500.
/// </summary>
[ApiController]
[Route("api/client-errors")]
[AllowAnonymous]
public class ClientErrorController(
    ILogger<ClientErrorController> logger, ErrorReportService errorReports) : ControllerBase
{
    // POST /api/client-errors — record one client-side crash report.
    [HttpPost]
    [EnableRateLimiting("clientErrors")]
    public async Task<IActionResult> Report([FromBody] ClientErrorReport report)
    {
        // The signed-in user, if a valid bearer token rode along — authentication still runs under
        // [AllowAnonymous]; it only skips the authorization check. Anonymous on the login page.
        var authed = User.Identity?.IsAuthenticated == true;
        var userName = authed ? (User.Identity!.Name ?? "(unnamed)") : "(anonymous)";
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        logger.LogWarning(
            "Client crash | user={User} ip={Ip} url={Url} ua={UserAgent} | message={Message} | stack={Stack} | componentStack={ComponentStack}",
            Clean(userName, 80), ip, Clean(report.Url, 500), Clean(report.UserAgent, 300),
            Clean(report.Message, 1000), Clean(report.Stack, 6000), Clean(report.ComponentStack, 6000));

        // Persist for the admin board — best-effort; must never fail the 204.
        try
        {
            // Prefer the correlation id of the ORIGINAL failing call (sent in the body) over this
            // POST's own id — that's the one that links to the relevant server log line.
            var correlationId = report.CorrelationId ?? CorrelationId.Get(HttpContext);
            var severity = Enum.TryParse<ErrorSeverity>(report.Severity, ignoreCase: true, out var s)
                ? s : ErrorSeverity.Error;
            await errorReports.PersistClientAsync(
                severity,
                message: report.Message ?? "(no message)",
                stack: report.Stack,
                componentStack: report.ComponentStack,
                routeUrl: report.Url,
                userAgent: report.UserAgent,
                userId: TryGetUserId(),
                userName: authed ? userName : null,
                userRole: authed ? User.FindFirstValue(ClaimTypes.Role) : null,
                ipAddress: ip,
                correlationId: correlationId);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to persist client ErrorReport");
        }

        // 204 — fire-and-forget; the client never blocks on or branches on the response.
        return NoContent();
    }

    private Guid? TryGetUserId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        return Guid.TryParse(raw, out var id) ? id : null;
    }

    // Collapse control chars (CR/LF/etc.) to spaces — anti log-forging — and hard-cap length.
    private static string Clean(string? s, int max)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var trimmed = s.Length > max ? s[..max] : s;
        return new string(trimmed.Select(c => char.IsControl(c) ? ' ' : c).ToArray());
    }
}

/// <summary>One client-side crash report. Lengths are hard ceilings (oversized → 400) so a single
/// report can't flood the log; the handler truncates further for log tidiness.</summary>
public record ClientErrorReport(
    [StringLength(2000)] string? Message,
    [StringLength(16000)] string? Stack,
    [StringLength(16000)] string? ComponentStack,
    [StringLength(1000)] string? Url,
    [StringLength(1000)] string? UserAgent,
    [StringLength(128)] string? CorrelationId = null,
    [StringLength(20)] string? Severity = null);
