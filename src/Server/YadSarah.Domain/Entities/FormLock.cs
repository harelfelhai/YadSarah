namespace YadSarah.Domain.Entities;

public class FormLock
{
    public Guid FormId { get; set; }
    public string SectionName { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public DateTime LockedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
}
