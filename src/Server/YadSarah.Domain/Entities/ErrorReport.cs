namespace YadSarah.Domain.Entities;

/// <summary>Where the error originated.</summary>
public enum ErrorSource { Client, Server }

public enum ErrorSeverity { Info, Warning, Error, Fatal }

/// <summary>Triage workflow state (Admin-managed), mirrors <see cref="FeedbackStatus"/>.</summary>
public enum ErrorStatus { New, Investigating, Resolved, Ignored }

/// <summary>
/// A captured runtime error — a client-side crash (React boundary / unhandled rejection) or an
/// unhandled server exception — persisted so an operator can investigate it after the fact
/// (Render free-tier stdout logs are ephemeral). Mirrors the <see cref="FeedbackReport"/> shape.
///
/// NOTE: <see cref="Message"/>/<see cref="Stack"/>/<see cref="ComponentStack"/>/<see cref="RouteUrl"/>
/// may inadvertently contain patient identifiers, so this table is treated as sensitive — read/edit
/// is Admin-only and every access is audited (see docs/security/02-security-controls.md). Stored
/// reports are pruned on a retention schedule.
/// </summary>
public class ErrorReport
{
    /// <summary>Append-only identity (never reused) — same posture as <see cref="AuditLog"/>.</summary>
    public long Id { get; set; }

    public ErrorSource Source { get; set; } = ErrorSource.Client;
    public ErrorSeverity Severity { get; set; } = ErrorSeverity.Error;

    /// <summary>Request-correlation id ("מספר תקלה") linking this report to the server log line.</summary>
    public string? CorrelationId { get; set; }

    public string Message { get; set; } = string.Empty;
    public string? Stack { get; set; }
    /// <summary>React component stack (client crashes only).</summary>
    public string? ComponentStack { get; set; }
    /// <summary>Client route / request path where it happened.</summary>
    public string? RouteUrl { get; set; }
    public string? UserAgent { get; set; }

    // ── Actor (snapshot; nullable — a crash on the login page is anonymous) ──
    public Guid? UserId { get; set; }
    public string? UserName { get; set; }
    public string? UserRole { get; set; }
    public string? IpAddress { get; set; }

    // ── Dedup: collapse an error "storm" into one row + counter ──
    /// <summary>Stable hash of source + message + top stack frame (see ErrorReportService).</summary>
    public string Fingerprint { get; set; } = string.Empty;
    public int OccurrenceCount { get; set; } = 1;
    public DateTime FirstSeenAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;

    // ── Triage (Admin-managed) ──
    public ErrorStatus Status { get; set; } = ErrorStatus.New;
    public string? AdminNotes { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public Guid? UpdatedByUserId { get; set; }
}
