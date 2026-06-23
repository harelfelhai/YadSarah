using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;
using YadSarah.Api.Hubs;

namespace YadSarah.Api.Controllers;

[ApiController]
// Medical forms hold clinical PHI — restricted to clinical staff (need-to-know).
// Reception is intentionally excluded. Sign/addenda are further limited to Doctor in the service.
[Authorize(Roles = "Doctor,Nurse,ShiftManager,Admin,MedStudent,NursingStudent,LabStaff")]
public class FormsController(FormService svc, IHubContext<MainHub> hub, AuditService audit, AuthService auth) : ControllerBase
{
    private Guid UserId =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);
    private string UserName =>
        User.FindFirstValue("fullName") ?? User.Identity?.Name ?? "Unknown";
    private UserRole UserRole =>
        Enum.TryParse<UserRole>(User.FindFirstValue(ClaimTypes.Role), out var r) ? r : UserRole.Reception;
    // All of the caller's roles — permissions on a form are the union (CanEdit / sign).
    private IReadOnlyCollection<UserRole> UserRoles =>
        User.FindAll(ClaimTypes.Role)
            .Select(c => Enum.TryParse<UserRole>(c.Value, out var r) ? (UserRole?)r : null)
            .Where(r => r.HasValue).Select(r => r!.Value).ToList();

    // Re-authentication gate for signing: the user must re-enter their own username+password.
    // Returns true only when the credentials are valid AND belong to the logged-in user
    // (a signature must be attributable to the person actually present, not to whoever's
    // session happens to be open). A single generic failure path avoids a credential oracle.
    private async Task<bool> ReauthAsync(SignRequest req)
    {
        var verified = await auth.VerifyCredentialsAsync(req.Username, req.Password);
        return verified is not null && verified.Id == UserId;
    }

    // Parses a JSON column, falling back to a default when empty/blank (legacy rows)
    private static JsonElement ParseJson(string? json, string fallback) =>
        JsonSerializer.Deserialize<JsonElement>(string.IsNullOrWhiteSpace(json) ? fallback : json);

    // Deserializes JSON columns so the response has named arrays (not raw strings)
    private static object MapForm(MedicalForm f) => new
    {
        id = f.Id,
        visitId = f.VisitId,
        stationType = f.StationType,
        formType = f.FormType,
        department = f.Department,
        trackOrder = f.TrackOrder,
        version = f.Version,
        chiefComplaint = f.ChiefComplaint,
        presentIllness = f.PresentIllness,
        pastMedicalHistory = f.PastMedicalHistory,
        triage = f.Triage,
        physicalExam = f.PhysicalExam,
        discussionAndPlan = f.DiscussionAndPlan,
        dischargeRecommendations = f.DischargeRecommendations,
        orderedUnits = f.OrderedUnits,
        allergies = ParseJson(f.AllergiesJson, "[]"),
        vitalSigns = ParseJson(f.VitalSignsJson, "[]"),
        treatments = ParseJson(f.TreatmentsJson, "[]"),
        administrationOrders = ParseJson(f.AdministrationOrdersJson, "[]"),
        diagnoses = ParseJson(f.DiagnosesJson, "[]"),
        dischargeMedications = ParseJson(f.DischargeMedicationsJson, "[]"),
        routing = ParseJson(f.RoutingJson, "[]"),
        isSigned = f.IsSigned,
        signedByUserId = f.SignedByUserId,
        signedByName = f.SignedByName,
        signedByLicense = f.SignedByLicense,
        signedBySpecialistLicense = f.SignedBySpecialistLicense,
        signedAt = f.SignedAt,
        postSignEditWindowMinutes = (int)FormService.PostSignEditWindow.TotalMinutes,
        fieldEdits = ParseJson(f.FieldEditsJson, "{}"),
        addenda = ParseJson(f.AddendaJson, "[]"),
        createdBy = f.CreatedByUserId,
        createdAt = f.CreatedAt,
        updatedBy = f.UpdatedByUserId,
        updatedAt = f.UpdatedAt,
    };

    // GET /api/visits/{visitId}/forms
    [HttpGet("api/visits/{visitId:guid}/forms")]
    public async Task<IActionResult> GetByVisit(Guid visitId)
    {
        var forms = await svc.GetByVisitAsync(visitId);
        await audit.LogAsync(AuditService.Viewed, "MedicalForm", visitId, "byVisit");
        return Ok(forms.Select(MapForm));
    }

    // POST /api/visits/{visitId}/forms
    [HttpPost("api/visits/{visitId:guid}/forms")]
    public async Task<IActionResult> Create(Guid visitId, [FromBody] CreateFormRequest req)
    {
        var form = new MedicalForm
        {
            VisitId = visitId,
            StationType = req.StationType,
            FormType = req.FormType,
            Department = req.Department,
            CreatedByUserId = UserId,
        };
        var created = await svc.CreateAsync(form);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, MapForm(created));
    }

    // GET /api/forms/{id}
    [HttpGet("api/forms/{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var f = await svc.GetByIdAsync(id);
        if (f is null) return NotFound();
        await audit.LogAsync(AuditService.Viewed, "MedicalForm", id);
        return Ok(MapForm(f));
    }

    // PATCH /api/forms/{id}/sections/{section}
    [HttpPatch("api/forms/{id:guid}/sections/{section}")]
    public async Task<IActionResult> UpdateSection(
        Guid id, string section, [FromBody] UpdateSectionRequest req)
    {
        try
        {
            // For array/object data, ToString() returns raw JSON; for strings, the string itself.
            var rawValue = req.Data is JsonElement je
                ? (je.ValueKind == JsonValueKind.String ? je.GetString()! : je.GetRawText())
                : req.Data?.ToString() ?? string.Empty;

            var updated = await svc.UpdateSectionAsync(
                id, section, rawValue, req.Version, UserId, UserName, UserRoles);

            await audit.LogAsync(AuditService.Updated, "MedicalForm", id, section);

            await hub.Clients.Group($"form_{id}").SendAsync("FormSectionUpdated", new
            {
                formId = id,
                sectionName = section,
                data = req.Data,
                editedByUserId = UserId,
                editedByName = UserName,
                editedAt = DateTime.UtcNow,
                version = updated.Version,
            });

            return Ok(MapForm(updated));
        }
        catch (ConcurrencyException ex)
        {
            return Conflict(new { message = ex.Message });
        }
        catch (ForbiddenException ex)
        {
            return StatusCode(403, new { message = ex.Message });
        }
        catch (FormSignedException ex)
        {
            return Conflict(new { message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            // Closed-list (catalog) rejection or unknown section.
            return BadRequest(new { message = ex.Message });
        }
    }

    // ── Signing ───────────────────────────────────────────────────────────

    // POST /api/forms/{id}/sign
    // Signing requires step-up re-authentication: the doctor re-enters their own
    // username+password. Rate-limited to thwart password brute-force on a stolen session.
    [HttpPost("api/forms/{id:guid}/sign")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Sign(Guid id, [FromBody] SignRequest req)
    {
        if (!await ReauthAsync(req))
        {
            await audit.LogAsync(AuditService.SignReauthFailed, "MedicalForm", id);
            // 403, not 401: the user's SESSION is valid — only the re-entered step-up
            // credentials are wrong. A 401 would trip the client's global "log out on 401"
            // handler and eject the user to /login instead of showing a retryable error.
            return StatusCode(403, new { message = "אימות נכשל — שם המשתמש או הסיסמה שגויים, או אינם תואמים למשתמש המחובר." });
        }
        try
        {
            var form = await svc.SignAsync(id, UserId, UserName, UserRoles);
            await audit.LogAsync(AuditService.Signed, "MedicalForm", id);
            await hub.Clients.Group($"form_{id}").SendAsync("FormSigned", new
            {
                formId = id,
                signedByName = form.SignedByName,
                signedAt = form.SignedAt,
            });
            return Ok(MapForm(form));
        }
        catch (ForbiddenException ex) { return StatusCode(403, new { message = ex.Message }); }
        catch (FormSignedException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    // POST /api/forms/{id}/addenda
    [HttpPost("api/forms/{id:guid}/addenda")]
    public async Task<IActionResult> AddAddendum(Guid id, [FromBody] AddAddendumRequest req)
    {
        try
        {
            var form = await svc.AddAddendumAsync(id, req.Text, UserId, UserName);
            await audit.LogAsync(AuditService.Created, "MedicalFormAddendum", id, "addendum");
            await hub.Clients.Group($"form_{id}").SendAsync("FormAddendaChanged", new { formId = id });
            return Ok(MapForm(form));
        }
        catch (FormSignedException ex) { return Conflict(new { message = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    // POST /api/forms/{id}/addenda/{addendumId}/sign
    // Each post-signature addendum is a separate signature → same step-up re-auth.
    [HttpPost("api/forms/{id:guid}/addenda/{addendumId:guid}/sign")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> SignAddendum(Guid id, Guid addendumId, [FromBody] SignRequest req)
    {
        if (!await ReauthAsync(req))
        {
            await audit.LogAsync(AuditService.SignReauthFailed, "MedicalForm", id, "addendum");
            // 403, not 401: the user's SESSION is valid — only the re-entered step-up
            // credentials are wrong. A 401 would trip the client's global "log out on 401"
            // handler and eject the user to /login instead of showing a retryable error.
            return StatusCode(403, new { message = "אימות נכשל — שם המשתמש או הסיסמה שגויים, או אינם תואמים למשתמש המחובר." });
        }
        try
        {
            var form = await svc.SignAddendumAsync(id, addendumId, UserId, UserName, UserRoles);
            await audit.LogAsync(AuditService.Signed, "MedicalFormAddendum", id, "addendum", newValue: addendumId.ToString());
            await hub.Clients.Group($"form_{id}").SendAsync("FormAddendaChanged", new { formId = id });
            return Ok(MapForm(form));
        }
        catch (ForbiddenException ex) { return StatusCode(403, new { message = ex.Message }); }
        catch (FormSignedException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    // POST /api/forms/{id}/locks/{section}
    [HttpPost("api/forms/{id:guid}/locks/{section}")]
    public async Task<IActionResult> AcquireLock(Guid id, string section)
    {
        var (acquired, lockedBy) = await svc.AcquireLockAsync(id, section, UserId, UserName);

        if (acquired)
        {
            await hub.Clients.Group($"form_{id}").SendAsync("LockAcquired", new
            {
                formId = id,
                sectionName = section,
                lockedByUserId = UserId,
                lockedByName = UserName,
                expiresAt = DateTime.UtcNow.AddMinutes(5),
            });
        }

        return Ok(new { acquired, lockedBy });
    }

    // DELETE /api/forms/{id}/locks/{section}
    [HttpDelete("api/forms/{id:guid}/locks/{section}")]
    public async Task<IActionResult> ReleaseLock(Guid id, string section)
    {
        await svc.ReleaseLockAsync(id, section, UserId);
        await hub.Clients.Group($"form_{id}").SendAsync("LockReleased", new
        {
            formId = id,
            sectionName = section,
        });
        return NoContent();
    }

    // GET /api/forms/{id}/export
    [HttpGet("api/forms/{id:guid}/export")]
    public async Task<IActionResult> Export(Guid id)
    {
        var form = await svc.GetByIdAsync(id);
        if (form is null) return NotFound();
        return Ok(MapForm(form));
    }

    public record CreateFormRequest(string StationType, string FormType, string? Department = null);
    public record UpdateSectionRequest(object? Data, int Version);
    public record AddAddendumRequest(string Text);

    // Step-up re-authentication payload for signing a form / addendum.
    // NB: validation attributes target the constructor PARAMETER (no `property:` prefix) —
    // ASP.NET model validation requires them on the record parameter, not the property.
    public record SignRequest(
        [Required, StringLength(100)] string Username,
        [Required, StringLength(200)] string Password);
}
