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
        // API/hub responses serve JSON/websockets only — lock everything down. The SPA
        // documents + bundled assets (served same-origin from wwwroot) get a policy that
        // mirrors the app's own <meta> CSP in index.html — script 'unsafe-inline'/'unsafe-eval'
        // and style 'unsafe-inline' are required by the bundle (Mantine + deps). A stricter
        // header here would INTERSECT with the meta tag and strip them → blank/dead UI.
        // Header still adds frame-ancestors (meta can't) and keeps /api+/hubs at 'none'.
        var isApiOrHub = context.Request.Path.StartsWithSegments("/api")
                         || context.Request.Path.StartsWithSegments("/hubs");
        h["Content-Security-Policy"] = isApiOrHub
            ? "default-src 'none'; frame-ancestors 'none'"
            : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
              + "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
              + "connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'";
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
