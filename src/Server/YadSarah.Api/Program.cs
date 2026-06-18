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
builder.Services.AddScoped<FormService>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<MedicationCatalogService>();
builder.Services.AddScoped<FeedbackService>();
builder.Services.AddScoped<DemoDataService>();
builder.Services.AddScoped<WorkstationService>();
builder.Services.AddScoped<ShiftStatusService>();
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
builder.Services.AddHttpClient<IDepartmentClassifier, YadSarah.Api.Services.LlmDepartmentClassifier>(
    c => c.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<YadSarah.Api.Services.FormPresenceService>();

// Sanitized error responses (no stack traces) in production
builder.Services.AddProblemDetails();

// ── JWT Auth ───────────────────────────────────────────────────────────────
var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? throw new InvalidOperationException("Jwt:Secret is required");

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

    // Lenient global limiter per IP (defense against API flooding)
    opt.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 300,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
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
}

// Behind a TLS-terminating proxy (Render) the app receives plain HTTP with the real
// scheme in X-Forwarded-Proto. Honor it FIRST so HSTS/HttpsRedirection see https and
// don't loop. KnownProxies/Networks are cleared because the proxy isn't on localhost.
var forwardedOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
};
forwardedOptions.KnownIPNetworks.Clear();
forwardedOptions.KnownProxies.Clear();
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
    return $"Host={uri.Host};Port={port};Database={db};Username={user};Password={pass};" +
           "SSL Mode=Require;Trust Server Certificate=true";
}
