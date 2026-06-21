using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using YadSarah.Application.Services;
using YadSarah.Infrastructure.Data;
using YadSarah.Api.Hubs;
using YadSarah.Api.Middleware;

var builder = WebApplication.CreateBuilder(args);

// ── Database ───────────────────────────────────────────────────────────────
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

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
// Public self-service intake: staging-table writes + reception review/conflict detection.
builder.Services.AddScoped<IntakeSubmissionService>();
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

    // Public self-service intake — per-IP anti-flood backstop (the per-device cap of 3 is the
    // primary limit, enforced in IntakeSubmissionService). Kept loose enough for a shared
    // waiting-room Wi-Fi where many patients submit from one NAT'd IP.
    opt.AddPolicy("publicIntake", ctx => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
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
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<MainHub>("/hubs/main");

app.Run();
