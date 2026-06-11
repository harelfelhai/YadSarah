using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public class VisitService(AppDbContext db)
{
    public async Task<List<Visit>> GetQueueAsync()
    {
        return await db.Visits
            .Include(v => v.Patient)
            .Where(v => v.Status != VisitStatus.Discharged)
            .OrderBy(v => v.QueueNumber)
            .ToListAsync();
    }

    public async Task<Visit?> GetByIdAsync(Guid id)
    {
        return await db.Visits
            .Include(v => v.Patient)
            .Include(v => v.Forms)
            .FirstOrDefaultAsync(v => v.Id == id);
    }

    public async Task<Visit> CreateAsync(Visit visit)
    {
        // Assign queue number: max of today's visits + 1
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var maxQueue = await db.Visits
            .Where(v => v.AdmissionDate == today)
            .MaxAsync(v => (int?)v.QueueNumber) ?? 0;

        visit.QueueNumber = maxQueue + 1;
        db.Visits.Add(visit);
        await db.SaveChangesAsync();
        return visit;
    }

    public async Task<Visit> UpdateStatusAsync(Guid id, VisitStatus status)
    {
        var visit = await db.Visits.FindAsync(id)
            ?? throw new KeyNotFoundException($"Visit {id} not found");
        visit.Status = status;
        visit.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return visit;
    }
}
