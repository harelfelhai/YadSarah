using System.Security.Claims;
using Microsoft.AspNetCore.Diagnostics;
using YadSarah.Api.Middleware;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Infrastructure;

/// <summary>
/// Observes every unhandled exception: logs it (structured, with the request correlation id) and
/// persists it as a server-side <see cref="ErrorReport"/> for the admin board. Returns
/// <c>false</c> so the framework's <c>UseExceptionHandler()</c> + ProblemDetails still produce the
/// sanitized (no stack-trace) error response — this handler only records, it does not respond.
///
/// Persistence is best-effort and wrapped so a DB failure (the DB is often the thing that's down)
/// never throws out of the error path. The durable record is the structured stdout log.
/// </summary>
public sealed class GlobalExceptionHandler(
    ILogger<GlobalExceptionHandler> logger,
    IServiceScopeFactory scopeFactory) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var correlationId = CorrelationId.Get(httpContext);
        var route = $"{httpContext.Request.Method} {httpContext.Request.Path}";
        var user = httpContext.User;
        var userName = user?.FindFirstValue("fullName") ?? user?.Identity?.Name;

        logger.LogError(exception,
            "Unhandled exception | correlationId={CorrelationId} route={Route} user={User}",
            correlationId ?? "-", route, userName ?? "(anonymous)");

        // Best-effort persist — must never throw out of the exception path.
        try
        {
            using var scope = scopeFactory.CreateScope();
            var svc = scope.ServiceProvider.GetRequiredService<ErrorReportService>();
            await svc.PersistServerAsync(
                ErrorSeverity.Error,
                message: exception.Message,
                stack: exception.ToString(),
                routeUrl: route,
                userId: user.TryGetUserId(),
                userName: userName,
                userRole: user?.FindFirstValue(ClaimTypes.Role),
                ipAddress: httpContext.Connection.RemoteIpAddress?.ToString(),
                correlationId: correlationId);
        }
        catch (Exception persistEx)
        {
            logger.LogWarning(persistEx,
                "Failed to persist server ErrorReport for correlationId={CorrelationId}", correlationId ?? "-");
        }

        // Let UseExceptionHandler + ProblemDetails own the response.
        return false;
    }
}
