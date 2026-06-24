using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using YadSarah.Api.Dtos;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

/// <summary>
/// PUBLIC (no-login) self-service intake. A patient fills their own details from a mobile device
/// (reached via the QR posted at reception) and the form lands in a STAGING table — never the
/// patient records, and with no patient lookup/auto-fill. Abuse is bounded two ways: a per-IP
/// rate-limit policy (anti-flood) and a per-device submission cap enforced in the service.
/// </summary>
[ApiController]
[Route("api/public-intake")]
[AllowAnonymous]
public partial class PublicIntakeController(
    IntakeSubmissionService intake, SettingsService settings, AuditService audit) : ControllerBase
{
    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")] private static partial Regex EmailRx();
    [GeneratedRegex(@"^[\d+\-() ]{6,20}$")] private static partial Regex PhoneRx();

    // POST /api/public-intake — accept one patient-filled form.
    [HttpPost]
    [EnableRateLimiting("publicIntake")] // per-IP anti-flood (the absolute, identity-independent
                                         // flood ceiling is chained into the GlobalLimiter in Program.cs)
    public async Task<IActionResult> Submit([FromBody] PublicIntakeRequest req, CancellationToken ct)
    {
        if (Validate(req) is { } error) return BadRequest(new { message = error });

        var entity = req.ToEntity();
        entity.SourceIp = HttpContext.Connection.RemoteIpAddress?.ToString();

        var limit = await settings.GetIntAsync(SettingsService.IntakeDeviceLimitKey, 3);
        var windowMinutes = await settings.GetIntAsync(SettingsService.IntakeDeviceWindowMinutesKey, 60);

        var result = await intake.CreateAsync(entity, limit, TimeSpan.FromMinutes(windowMinutes), ct);
        if (!result.Accepted)
            return StatusCode(StatusCodes.Status429TooManyRequests,
                new { message = $"בוצעו כבר {limit} שליחות מהמכשיר הזה. נסו שוב מאוחר יותר או פנו לדלפק הקבלה." });

        await audit.LogAsync("IntakeSubmitted", "PatientIntakeSubmission", result.Submission!.Id);
        return StatusCode(StatusCodes.Status201Created, new { id = result.Submission!.Id });
    }

    // Server-side content validation (the trust boundary). Lengths are enforced by the DTO
    // attributes; here we reject markup in names and malformed email/phone — mirrors PatientsController.
    private static string? Validate(PublicIntakeRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.FirstName) || string.IsNullOrWhiteSpace(r.LastName))
            return "יש למלא שם פרטי ושם משפחה.";

        if (HasAngleBrackets(r.FirstName) || HasAngleBrackets(r.LastName) || HasAngleBrackets(r.FatherName))
            return "השם אינו יכול להכיל את התווים < או >.";

        if (!string.IsNullOrWhiteSpace(r.Email) && !EmailRx().IsMatch(r.Email.Trim()))
            return "כתובת דוא\"ל אינה תקינה.";

        foreach (var phone in new[] { r.PhoneMobile, r.PhoneHome, r.DigitalContactPhone })
            if (!string.IsNullOrWhiteSpace(phone) && !PhoneRx().IsMatch(phone.Trim()))
                return "מספר טלפון אינו תקין.";

        return null;
    }

    private static bool HasAngleBrackets(string? s) =>
        s is not null && (s.Contains('<') || s.Contains('>'));
}
