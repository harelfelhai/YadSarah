namespace YadSarah.Domain.Entities;

public enum FeedbackType { Bug, FixNeeded, Improvement, Other }

public enum FeedbackStatus { New, InProgress, Resolved, Rejected }

/// <summary>
/// A user-submitted report — a bug, a needed fix, an improvement idea, or other.
/// Submittable from any screen via the floating widget; managed by Admin.
///
/// NOTE: the free-text <see cref="Description"/> may inadvertently contain patient
/// identifiers, so this table is treated as sensitive — read/edit is Admin-only and
/// access is audited (see docs/security/02-security-controls.md).
/// </summary>
public class FeedbackReport
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Screen the report refers to, or "כללי" (general).</summary>
    public string Screen { get; set; } = "כללי";

    /// <summary>Field the report refers to, or "כללי" (general).</summary>
    public string FieldName { get; set; } = "כללי";

    public FeedbackType ReportType { get; set; } = FeedbackType.Bug;

    public string Description { get; set; } = string.Empty;

    /// <summary>Auto-captured client route at submission time (context even when "כללי").</summary>
    public string? RouteUrl { get; set; }

    // ── Workflow (Admin-managed) ──
    public FeedbackStatus Status { get; set; } = FeedbackStatus.New;
    public string? AdminNotes { get; set; }

    // ── Reporter (snapshot) ──
    public Guid CreatedByUserId { get; set; }
    public string CreatedByName { get; set; } = string.Empty;
    public string CreatedByRole { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // ── Last admin edit ──
    public DateTime? UpdatedAt { get; set; }
    public Guid? UpdatedByUserId { get; set; }
}
