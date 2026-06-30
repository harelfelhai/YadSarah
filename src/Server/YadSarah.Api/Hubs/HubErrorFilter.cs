using Microsoft.AspNetCore.SignalR;

namespace YadSarah.Api.Hubs;

/// <summary>
/// Centralizes logging of exceptions thrown by any hub method. SignalR otherwise swallows hub-method
/// failures (the client just sees the invocation reject) — this surfaces them in the structured log,
/// keyed by connection + method, so a broken realtime path is visible to an operator. Hub invocations
/// are not HTTP requests, so they have no per-request correlation id; the ConnectionId is the key.
/// </summary>
public sealed class HubErrorFilter(ILogger<HubErrorFilter> logger) : IHubFilter
{
    public async ValueTask<object?> InvokeMethodAsync(
        HubInvocationContext context, Func<HubInvocationContext, ValueTask<object?>> next)
    {
        try
        {
            return await next(context);
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "Hub method failed | hub={Hub} method={Method} connectionId={ConnectionId} user={User}",
                context.Hub.GetType().Name, context.HubMethodName, context.Context.ConnectionId,
                context.Context.UserIdentifier ?? "(anonymous)");
            throw; // preserve existing behavior — the client still sees the invocation fail
        }
    }
}
