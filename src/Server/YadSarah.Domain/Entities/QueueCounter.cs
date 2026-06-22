namespace YadSarah.Domain.Entities;

/// <summary>
/// One row per (queue-day, queue-letter), holding the last running number issued for
/// that letter that day. Each department gets its own letter (A,B,C,…) plus "S" for the
/// special/priority queue, so numbers run separately per department and reset to 1 each
/// day. An atomic UPSERT guarantees no two patients get the same number concurrently.
/// </summary>
public class QueueCounter
{
    public DateOnly DateKey { get; set; }
    public string QueueLetter { get; set; } = "";
    public int LastNumber { get; set; }
}
