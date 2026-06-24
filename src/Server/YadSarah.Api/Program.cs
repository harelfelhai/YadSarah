using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using YadSarah.Application.Services;
using YadSarah.Infrastructure.Data;
using YadSarah.Api.Hubs;
using YadSarah.Api.Middleware;

var builder = WebApplication.CreateBuilder(args);

// ── Database ───────────────────────────────────────────────────────────────
// Accept either an Npgsql key-value string or a postgres:// URL — managed hosts
// (Render/Neon) hand out the URL form, which Npgsql does not parse natively.
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseNpgsql(NormalizePostgresConnectionString(
        builder.Configuration.GetConnectionString("Default"))));

// ── Services ───────────────────────────────────────────────────────────────
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<VisitService>();
builder.Services.AddScoped<CareStepService>();
builder.Services.AddScoped<FormService>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<MedicationCatalogService>();
builder.Services.AddScoped<DiagnosisCatalogService>();
builder.Services.AddScoped<DiagnosisImportService>();
builder.Services.AddScoped<FeedbackService>();
builder.Services.AddScoped<DemoDataService>();
builder.Services.AddScoped<WorkstationService>();
builder.Services.AddScoped<ShiftStatusService>();
builder.Services.AddScoped<AnalyticsService>();
// Typed HttpClient for the MoH drug-registry sync (timeout guards against a hung WAF).
builder.Services.AddHttpClient<MedicationSyncService>(c => c.Timeout = TimeSpan.FromSeconds(60));
builder.Services.AddHostedService<YadSarah.Api.Services.MedicationSyncBackgroundService>();
builder.Services.AddScoped<StreetCatalogService>();
// Typed HttpClient for the data.gov.il streets sync (large dataset → generous timeout).
builder.Services.AddHttpClient<StreetSyncService>(c => c.Timeout = TimeSpan.FromSeconds(120));
builder.Services.AddHostedService<YadSarah.Api.Services.StreetSyncBackgroundService>();
// Reception: server-derived pricing + AI department routing. The classifier is config-gated
// (DepartmentRouting:Enabled + ApiKey) and falls back deterministically when off → safe by default.
builder.Services.AddScoped<DepartmentRoutingService>();
builder.Services.AddScoped<PricingService>();
// Public self-service intake: staging-table writes + reception review/conflict detection.
builder.Services.AddScoped<IntakeSubmissionService>();
builder.Services.AddHttpClient<IDepartmentClassifier, YadSarah.Api.Services.LlmDepartmentClassifier>(
    c => c.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<YadSarah.Api.Services.FormPresenceService>();

// Sanitized error responses (no stack traces) in production
builder.Services.AddProblemDetails();

// In-memory store for the per-manager discount re-auth throttle (VisitsController.Create) —
// keyed on the target manager username, independent of the (spoofable) client IP.
builder.Services.AddMemoryCache();

// ── JWT Auth ───────────────────────────────────────────────────────────────
var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? throw new InvalidOperationException("Jwt:Secret is required");

// Fail loud rather than fail open: a deployment that ships the committed placeholder (or any
// short/low-entropy key) would run with a publicly-known HS256 signing key → anyone could forge
// an Admin token. Reject the known placeholder and enforce the >=32-byte HS256 minimum. The
// placeholder check is gated to non-Development so local dev stays convenient.
if (Encoding.UTF8.GetByteCount(jwtSecret) < 32 ||
    (!builder.Environment.IsDevelopment() && jwtSecret.Contains("CHANGE_ME")))
    throw new InvalidOperationException(
        "Jwt:Secret must be overridden with a >=32-byte random value (the committed placeholder is not allowed in non-Development).");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "YadSarah",
            ValidAudience = builder.Configuration["Jwt:Audience"] ?? "YadSarahClient",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ClockSkew = TimeSpan.FromSeconds(30), // tighten default 5-min token-expiry grace
        };
        // Allow SignalR to read token from query string
        opt.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) &&
                    ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    ctx.Token = token;
                return Task.CompletedTask;
            },
            // Request-time account-state revocation: [Authorize] alone only checks the token's
            // signature/lifetime, so a 12h JWT would otherwise outlive deactivation, lockout, a
            // role change, or a password reset. Re-read the user on every authenticated request
            // (cheap projected lookup) and reject the token if the account is no longer usable or
            // its SecurityStamp has moved on (bumped on deactivate/lockout/role-change/pw-reset).
            OnTokenValidated = async ctx =>
            {
                var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                var sub = ctx.Principal?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                          ?? ctx.Principal?.FindFirst("sub")?.Value;
                if (!Guid.TryParse(sub, out var userId)) { ctx.Fail("invalid subject"); return; }

                var account = await db.Users
                    .Where(u => u.Id == userId)
                    .Select(u => new { u.IsActive, u.LockoutEndAt, u.AccountExpiresAt, u.SecurityStamp })
                    .FirstOrDefaultAsync();

                if (account is null || !account.IsActive
                    || (account.LockoutEndAt.HasValue && account.LockoutEndAt.Value > DateTime.UtcNow)
                    || (account.AccountExpiresAt.HasValue && account.AccountExpiresAt.Value < DateTime.UtcNow))
                {
                    ctx.Fail("account is inactive, locked, or expired");
                    return;
                }

                var stamp = ctx.Principal?.FindFirst("stamp")?.Value;
                if (!string.Equals(stamp, account.SecurityStamp, StringComparison.Ordinal))
                    ctx.Fail("token superseded by a security-state change");
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddSignalR();
builder.Services.AddControllers()
    .AddJsonOptions(opts =>
    {
        opts.JsonSerializerOptions.ReferenceHandler =
            System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
        opts.JsonSerializerOptions.Converters.Add(
            new System.Text.Json.Serialization.JsonStringEnumConverter());
        opts.JsonSerializerOptions.Converters.Add(
            new YadSarah.Api.Converters.TimeOnlyJsonConverter());
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ── Rate limiting (brute-force / abuse protection) ─────────────────────────
builder.Services.AddRateLimiter(opt =>
{
    opt.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Strict limiter for login — per client IP
    opt.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));

    // Public self-service intake — per-IP anti-flood backstop. Both this and the per-device cap
    // (IntakeSubmissionService) key on attacker-rotatable values (client deviceId / spoofable
    // X-Forwarded-For), so the GlobalLimiter below adds an absolute, identity-independent flood
    // ceiling for the intake POST. Kept loose enough for a shared waiting-room Wi-Fi where many
    // patients submit from one NAT'd IP.
    opt.AddPolicy("publicIntake", ctx => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));

    // Global limiter = two chained partitioners applied to every request:
    //   (1) lenient per-IP cap (general API-flood defense);
    //   (2) an absolute, IP-INDEPENDENT ceiling on the public-intake POST — ALL anonymous
    //       submissions share one fixed window, so neither a rotated deviceId nor a spoofed
    //       X-Forwarded-For can multiply the allowance and bury reception's review board.
    opt.GlobalLimiter = PartitionedRateLimiter.CreateChained(
        PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
            RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 300,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                })),
        PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
            HttpMethods.IsPost(ctx.Request.Method) &&
            ctx.Request.Path.StartsWithSegments("/api/public-intake")
                ? RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: "public-intake-global",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 60,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    })
                : RateLimitPartition.GetNoLimiter("none")));
});

// ── CORS (LAN only — no public origin needed) ─────────────────────────────
builder.Services.AddCors(opt => opt.AddDefaultPolicy(p =>
    p.WithOrigins(
        builder.Configuration.GetSection("AllowedOrigins").Get<string[]>()
        ?? ["http://localhost:5173"])
     .AllowAnyHeader()
     .AllowAnyMethod()
     .AllowCredentials()));

var app = builder.Build();

// ── Migrate on startup ─────────────────────────────────────────────────────
using (var scope = app.Services.CreateScope())
{
    var dbCtx = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    dbCtx.Database.Migrate();
    await scope.ServiceProvider.GetRequiredService<SettingsService>().EnsureDefaultsAsync();
    // Seed the curated Hebrew ED diagnosis catalog on first run (closed picker needs a
    // catalog to be usable; no live Hebrew ICD source exists). No-op once populated.
    await scope.ServiceProvider.GetRequiredService<DiagnosisCatalogService>().SeedDefaultsAsync();
}

// Behind a TLS-terminating proxy (Render) the app receives plain HTTP with the real scheme in
// X-Forwarded-Proto, and the real client IP in X-Forwarded-For. We MUST honor those so HSTS /
// HttpsRedirection don't loop and so the per-IP rate limiters / audit SourceIp see the real
// client rather than the proxy. The risk: trusting X-Forwarded-For from an UNTRUSTED peer lets a
// caller spoof their IP and evade the per-IP rate limits. We bound that two ways:
//   • ForwardLimit = 1 — only the single hop added by the immediate upstream is honored; any extra
//     client-injected XFF entries to its left are ignored. Behind Render (the only network path to
//     the container) the rightmost entry is the real client, so spoofing requires DIRECT access.
//   • Optional ForwardedHeaders:KnownProxyNetworks config (CIDR list) — when set, forwarded headers
//     are honored ONLY from those proxy networks and ignored on any direct connection, closing the
//     "if ever directly reachable" gap. Leave it unset to trust the immediate upstream (current
//     Render behavior); set it to the proxy/egress CIDR for defense in depth.
var forwardedOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1,
};
forwardedOptions.KnownIPNetworks.Clear();
forwardedOptions.KnownProxies.Clear();
var knownProxyCidrs = builder.Configuration
    .GetSection("ForwardedHeaders:KnownProxyNetworks").Get<string[]>();
if (knownProxyCidrs is { Length: > 0 })
{
    foreach (var cidr in knownProxyCidrs)
    {
        var parts = cidr.Split('/', 2);
        if (parts.Length == 2 &&
            System.Net.IPAddress.TryParse(parts[0], out var prefix) &&
            int.TryParse(parts[1], out var len))
            forwardedOptions.KnownIPNetworks.Add(new System.Net.IPNetwork(prefix, len));
    }
}
app.UseForwardedHeaders(forwardedOptions);

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    // Sanitized ProblemDetails (no stack traces) + HTTP Strict Transport Security
    app.UseExceptionHandler();
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.UseSecurityHeaders();

// Serve the bundled React SPA (copied into wwwroot by the Docker build). Static assets
// are public and served before the rate limiter so a page's asset burst isn't throttled.
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<MainHub>("/hubs/main");
// Client-side routes (e.g. /queue) on full page load fall through to the SPA shell.
app.MapFallbackToFile("index.html");

app.Run();

// Converts a postgres://user:pass@host:port/db URL (managed-host style) into an Npgsql
// key-value connection string with SSL required. Pass-through if already key-value.
static string? NormalizePostgresConnectionString(string? raw)
{
    if (string.IsNullOrWhiteSpace(raw)) return raw;
    if (!raw.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
        !raw.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        return raw;

    var uri = new Uri(raw);
    var parts = uri.UserInfo.Split(':', 2);
    var user = Uri.UnescapeDataString(parts[0]);
    var pass = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : "";
    var db = uri.AbsolutePath.Trim('/');
    var port = uri.Port > 0 ? uri.Port : 5432;
    // TLS to the DB. The connection is always ENCRYPTED (SSL Mode=Require). Certificate VERIFICATION
    // is deployment-gated and configurable: Render's managed Postgres presents a cert from Render's
    // PRIVATE CA over its internal network, so the public system trust store can't validate it and a
    // hard "VerifyFull" would fail to connect. Default therefore trusts the server cert (encrypted,
    // but MITM-detectable only at the network layer). To harden to full verification where the cert
    // chain is available, set Database:SslMode=VerifyFull and mount the CA via Database:RootCert
    // (e.g. Render's downloadable CA bundle) — see docs/security.
    var sslMode = Environment.GetEnvironmentVariable("Database__SslMode");
    var rootCert = Environment.GetEnvironmentVariable("Database__RootCert");
    var sslClause = string.IsNullOrWhiteSpace(sslMode)
        ? "SSL Mode=Require;Trust Server Certificate=true"
        : $"SSL Mode={sslMode}" + (string.IsNullOrWhiteSpace(rootCert) ? "" : $";Root Certificate={rootCert}");
    return $"Host={uri.Host};Port={port};Database={db};Username={user};Password={pass};" + sslClause;
}
