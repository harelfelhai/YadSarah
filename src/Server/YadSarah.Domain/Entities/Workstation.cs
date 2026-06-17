namespace YadSarah.Domain.Entities;

/// <summary>
/// A physical computer on the LAN, identified by a stable per-browser device id and
/// pinned to a fixed room. The room is set on the first connection from that machine
/// (any authenticated user) and reused permanently; an admin may reassign it.
///
/// <see cref="CurrentUser"/> fields track who is currently sitting at the machine
/// (the latest login from this device) so the shift-status board can place each
/// worker in their room.
/// </summary>
public class Workstation
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // Stable UUID generated and stored in the browser's localStorage on first load.
    public string DeviceId { get; set; } = string.Empty;

    public string RoomName { get; set; } = string.Empty;

    // Current occupant — set on each successful login from this device.
    public Guid? CurrentUserId { get; set; }
    public string? CurrentUserName { get; set; }
    public UserRole? CurrentUserRole { get; set; }
    public DateTime? LastLoginAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
