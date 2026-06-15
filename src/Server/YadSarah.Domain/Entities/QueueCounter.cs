namespace YadSarah.Domain.Entities;

/// <summary>
/// One row per day, holding the last running queue number issued that day.
/// Lets the queue number reset to 1 each day (numbers stay small) while an
/// atomic UPSERT guarantees no two patients get the same number concurrently.
/// </summary>
public class QueueCounter
{
    public DateOnly DateKey { get; set; }
    public int LastNumber { get; set; }
}
