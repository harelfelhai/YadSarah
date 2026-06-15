using System.Collections.Concurrent;

namespace YadSarah.Api.Services;

// Singleton in-memory store of who is currently viewing each form.
// Works correctly for a single-server on-prem deployment.
public class FormPresenceService
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, UserInfo>> _formUsers = new();

    public void Add(string formId, string connectionId, UserInfo info) =>
        _formUsers.GetOrAdd(formId, _ => new()).AddOrUpdate(connectionId, info, (_, _) => info);

    public void Remove(string formId, string connectionId) =>
        _formUsers.GetValueOrDefault(formId)?.TryRemove(connectionId, out _);

    public IReadOnlyList<UserInfo> GetPresent(string formId) =>
        _formUsers.GetValueOrDefault(formId)?.Values.ToList() ?? [];

    // Remove all forms a disconnected connection was in
    public void RemoveConnection(string connectionId)
    {
        foreach (var form in _formUsers.Values)
            form.TryRemove(connectionId, out _);
    }
}

public record UserInfo(string UserId, string FullName, string Role);
