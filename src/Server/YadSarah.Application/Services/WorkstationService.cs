using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>
/// Maps each LAN computer (stable browser device id) to a fixed room, and tracks the
/// current occupant (latest login from that device). The room is set once on the first
/// connection from a machine and reused permanently; an admin can reassign it.
/// </summary>
public class WorkstationService(AppDbContext db)
{
    public Task<Workstation?> GetByDeviceAsync(string deviceId) =>
        db.Workstations.FirstOrDefaultAsync(w => w.DeviceId == deviceId);

    /// <summary>Resolves a device id to its room name, or null if the device is unknown.</summary>
    public async Task<string?> ResolveRoomAsync(string? deviceId)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) return null;
        var ws = await db.Workstations.AsNoTracking().FirstOrDefaultAsync(w => w.DeviceId == deviceId);
        return ws?.RoomName;
    }

    /// <summary>
    /// First-connect room assignment (any authenticated user). Creates the workstation
    /// if new; updates the room if it already exists. Also records the acting user as the
    /// current occupant.
    /// </summary>
    public async Task<Workstation> SetRoomAsync(string deviceId, string roomName, Guid userId, string userName, UserRole role)
    {
        var ws = await db.Workstations.FirstOrDefaultAsync(w => w.DeviceId == deviceId);
        if (ws is null)
        {
            ws = new Workstation { DeviceId = deviceId };
            db.Workstations.Add(ws);
        }
        ws.RoomName = roomName.Trim();
        ws.CurrentUserId = userId;
        ws.CurrentUserName = userName;
        ws.CurrentUserRole = role;
        ws.LastLoginAt = DateTime.UtcNow;
        ws.UpdatedAt = DateTime.UtcNow;
        await ClearUserFromOtherWorkstationsAsync(userId, deviceId);
        await db.SaveChangesAsync();
        return ws;
    }

    /// <summary>
    /// On login: if the device is already mapped to a room, record this user as its
    /// current occupant and return the room. Returns null when the device is unknown
    /// (the client then prompts to set the room).
    /// </summary>
    public async Task<string?> SetOccupantAsync(string? deviceId, Guid userId, string userName, UserRole role)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) return null;
        var ws = await db.Workstations.FirstOrDefaultAsync(w => w.DeviceId == deviceId);
        if (ws is null) return null;
        ws.CurrentUserId = userId;
        ws.CurrentUserName = userName;
        ws.CurrentUserRole = role;
        ws.LastLoginAt = DateTime.UtcNow;
        ws.UpdatedAt = DateTime.UtcNow;
        await ClearUserFromOtherWorkstationsAsync(userId, deviceId);
        await db.SaveChangesAsync();
        return ws.RoomName;
    }

    /// <summary>
    /// A user occupies one workstation at a time. Before recording them as the occupant
    /// of <paramref name="keepDeviceId"/>, clear them from any other workstation they were
    /// the current occupant of — so a login "moves" the person rather than leaving a phantom
    /// occupant on their previous computer (which made the shift board show one user in two
    /// rooms). Marks the rows dirty; the caller's SaveChangesAsync persists it in one unit.
    /// </summary>
    private async Task ClearUserFromOtherWorkstationsAsync(Guid userId, string keepDeviceId)
    {
        var others = await db.Workstations
            .Where(w => w.CurrentUserId == userId && w.DeviceId != keepDeviceId)
            .ToListAsync();
        foreach (var w in others)
        {
            w.CurrentUserId = null;
            w.CurrentUserName = null;
            w.CurrentUserRole = null;
            w.UpdatedAt = DateTime.UtcNow;
        }
    }

    public Task<List<Workstation>> GetAllAsync() =>
        db.Workstations.AsNoTracking().OrderBy(w => w.RoomName).ToListAsync();

    /// <summary>Distinct existing room names — used to suggest rooms on first connect.</summary>
    public Task<List<string>> GetRoomNamesAsync() =>
        db.Workstations.AsNoTracking()
            .Where(w => w.RoomName != "")
            .Select(w => w.RoomName)
            .Distinct()
            .OrderBy(r => r)
            .ToListAsync();

    public async Task<Workstation> UpdateRoomAsync(Guid id, string roomName)
    {
        var ws = await db.Workstations.FindAsync(id)
            ?? throw new KeyNotFoundException($"Workstation {id} not found");
        ws.RoomName = roomName.Trim();
        ws.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return ws;
    }
}
