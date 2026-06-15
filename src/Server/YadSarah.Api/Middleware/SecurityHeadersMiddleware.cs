namespace YadSarah.Api.Middleware;

/// <summary>
/// Adds defensive HTTP response headers (clickjacking, MIME-sniffing, referrer
/// leakage, feature access, and a restrictive CSP for API responses).
/// </summary>
public class SecurityHeadersMiddleware(RequestDelegate next)
{
    public async Task Invoke(HttpContext context)
    {
        var h = context.Response.Headers;
        h["X-Content-Type-Options"] = "nosniff";
        h["X-Frame-Options"] = "DENY";
        h["Referrer-Policy"] = "no-referrer";
        h["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()";
        // API serves JSON only — lock everything down; the SPA sets its own CSP.
        h["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
        h["X-Permitted-Cross-Domain-Policies"] = "none";
        // Don't advertise the server stack
        h.Remove("Server");
        h.Remove("X-Powered-By");

        await next(context);
    }
}

public static class SecurityHeadersExtensions
{
    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) =>
        app.UseMiddleware<SecurityHeadersMiddleware>();
}
