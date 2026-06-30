using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace YadSarah.Api.Controllers;

/// <summary>
/// PUBLIC (no-login) sink for client-side crash reports. The React root error boundary POSTs here
/// when a render exception would otherwise white-screen the app, so an operator can SEE the stack
/// trace in the server log (Render) instead of it dying silently in a user's browser console.
///
/// Security posture: anonymous (a crash on the login page must still report) but tightly bounded —
/// a dedicated per-IP rate-limit policy caps abuse, every field has a hard length cap (DTO
/// attributes reject oversized payloads), and all logged text is stripped of control characters to
/// prevent log forging. The report is written to the application log ONLY: it is not persisted, not
/// echoed back, and never touches the audit log or any PHI store. A crash message could incidentally
/// contain PHI, so it inherits the same trust boundary as the rest of the server logs
/// (see docs/security/02-security-controls.md).
/// </summary>
[ApiController]
[Route("api/client-errors")]
[AllowAnonymous]
public class ClientErrorController(ILogger<ClientErrorController> logger) : ControllerBase
{
    // POST /api/client-errors — record one client-side crash report.
    [HttpPost]
    [EnableRateLimiting("clientErrors")]
    public IActionResult Report([FromBody] ClientErrorReport report)
    {
        // The signed-in user, if a valid bearer token rode along — authentication still runs under
        // [AllowAnonymous]; it only skips the authorization check. Anonymous on the login page.
        var user = User.Identity?.IsAuthenticated == true ? (User.Identity!.Name ?? "(unnamed)") : "(anonymous)";
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        logger.LogWarning(
            "Client crash | user={User} ip={Ip} url={Url} ua={UserAgent} | message={Message} | stack={Stack} | componentStack={ComponentStack}",
            Clean(user, 80), ip, Clean(report.Url, 500), Clean(report.UserAgent, 300),
            Clean(report.Message, 1000), Clean(report.Stack, 6000), Clean(report.ComponentStack, 6000));

        // 204 — fire-and-forget; the client never blocks on or branches on the response.
        return NoContent();
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
    [StringLength(1000)] string? UserAgent);
