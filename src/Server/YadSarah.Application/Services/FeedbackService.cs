using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public class FeedbackService(AppDbContext db)
{
    public async Task<FeedbackReport> CreateAsync(
        string screen, string fieldName, FeedbackType type, string description, string? routeUrl,
        Guid userId, string userName, string userRole)
    {
        var report = new FeedbackReport
        {
            Screen = string.IsNullOrWhiteSpace(screen) ? "כללי" : screen.Trim(),
            FieldName = string.IsNullOrWhiteSpace(fieldName) ? "כללי" : fieldName.Trim(),
            ReportType = type,
            Description = description.Trim(),
            RouteUrl = routeUrl?.Trim(),
            Status = FeedbackStatus.New,
            CreatedByUserId = userId,
            CreatedByName = userName,
            CreatedByRole = userRole,
            CreatedAt = DateTime.UtcNow,
        };
        db.FeedbackReports.Add(report);
        await db.SaveChangesAsync();
        return report;
    }

    public async Task<List<FeedbackReport>> GetAllAsync(int take = 500) =>
        await db.FeedbackReports.AsNoTracking()
            .OrderByDescending(f => f.CreatedAt)
            .Take(Math.Clamp(take, 1, 1000))
            .ToListAsync();

    /// <summary>Admin edit: status, admin notes, and the descriptive fields.</summary>
    public async Task<FeedbackReport> UpdateAsync(
        Guid id, FeedbackStatus status, string? adminNotes,
        string screen, string fieldName, FeedbackType type, string description, Guid adminUserId)
    {
        var report = await db.FeedbackReports.FindAsync(id)
            ?? throw new KeyNotFoundException($"Feedback {id} not found");

        report.Status = status;
        report.AdminNotes = string.IsNullOrWhiteSpace(adminNotes) ? null : adminNotes.Trim();
        report.Screen = string.IsNullOrWhiteSpace(screen) ? "כללי" : screen.Trim();
        report.FieldName = string.IsNullOrWhiteSpace(fieldName) ? "כללי" : fieldName.Trim();
        report.ReportType = type;
        report.Description = description.Trim();
        report.UpdatedAt = DateTime.UtcNow;
        report.UpdatedByUserId = adminUserId;

        await db.SaveChangesAsync();
        return report;
    }
}
