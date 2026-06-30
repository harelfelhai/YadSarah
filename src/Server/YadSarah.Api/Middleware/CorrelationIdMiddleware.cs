using System.Text.RegularExpressions;
using Serilog.Context;

namespace YadSarah.Api.Middleware;

/// <summary>
/// Stamps every request with a correlation id ("מספר תקלה") so a client crash report, the server
/// log line, the ProblemDetails error body, and any persisted ErrorReport all share one id an
/// operator can grep. Reuses a caller-supplied <c>X-Request-Id</c> when present and well-formed
/// (so a chain of calls keeps one id), else generates one. Echoes it back in the response header.
///
/// Runs EARLY in the pipeline — before auth — so <see cref="HttpContext.User"/> is not yet
/// populated here; user enrichment happens later (in the exception handler / controllers).
/// </summary>
public partial class CorrelationIdMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Request-Id";
    public const string ItemsKey = "CorrelationId";

    public async Task Invoke(HttpContext context)
    {
        var incoming = context.Request.Headers[HeaderName].ToString();
        var id = IsWellFormed(incoming) ? incoming : Guid.NewGuid().ToString("N");

        context.Items[ItemsKey] = id;
        // Set before the response starts (we're at the top of the pipeline) so it always rides back.
        context.Response.Headers[HeaderName] = id;

        using (LogContext.PushProperty("CorrelationId", id))
            await next(context);
    }

    // Accept only short, safe ids — rejects log-forging / oversized client-supplied values.
    private static bool IsWellFormed(string? s) =>
        !string.IsNullOrEmpty(s) && s.Length <= 128 && SafeId().IsMatch(s);

    [GeneratedRegex(@"^[A-Za-z0-9\-]+$")]
    private static partial Regex SafeId();
}

/// <summary>Read the current request's correlation id (set by <see cref="CorrelationIdMiddleware"/>).</summary>
public static class CorrelationId
{
    public static string? Get(HttpContext? context) =>
        context?.Items.TryGetValue(CorrelationIdMiddleware.ItemsKey, out var v) == true ? v as string : null;
}

public static class CorrelationIdExtensions
{
    public static IApplicationBuilder UseCorrelationId(this IApplicationBuilder app) =>
        app.UseMiddleware<CorrelationIdMiddleware>();
}
