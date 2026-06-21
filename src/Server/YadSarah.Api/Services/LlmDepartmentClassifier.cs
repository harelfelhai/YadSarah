using System.Text;
using System.Text.Json;
using YadSarah.Application.Services;

namespace YadSarah.Api.Services;

/// <summary>
/// LLM-backed department classifier (Claude Messages API). Config-gated: returns null
/// (⇒ deterministic fallback) unless <c>DepartmentRouting:Enabled</c> is true AND an API key
/// is present. Internet in the critical path is permitted (on-prem constraint dropped 2026-06-19).
///
/// TODO(pending): <see cref="BuildSystemPrompt"/> is a PLACEHOLDER. The client will supply the
/// routing rules + few-shot examples and the algorithmic pre-narrowing — drop them in here and
/// in <see cref="DepartmentRoutingService"/>. Config keys (appsettings / env, NOT the DB —
/// the key is a secret): DepartmentRouting:{Enabled,ApiKey,Model}.
/// </summary>
public class LlmDepartmentClassifier(
    HttpClient http, IConfiguration config, ILogger<LlmDepartmentClassifier> log) : IDepartmentClassifier
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    public async Task<DepartmentClassification?> ClassifyAsync(
        string admissionReason, IReadOnlyList<string> candidates, RoutingContext ctx, CancellationToken ct = default)
    {
        if (!config.GetValue("DepartmentRouting:Enabled", false)) return null;
        var apiKey = config["DepartmentRouting:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey)) return null;

        var model = config["DepartmentRouting:Model"] ?? "claude-opus-4-8";
        try
        {
            var body = new
            {
                model,
                max_tokens = 200,
                system = BuildSystemPrompt(candidates),
                messages = new[] { new { role = "user", content = BuildUserPrompt(admissionReason, ctx) } },
            };
            using var msg = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
            msg.Headers.Add("x-api-key", apiKey);
            msg.Headers.Add("anthropic-version", "2023-06-01");
            msg.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

            using var res = await http.SendAsync(msg, ct);
            if (!res.IsSuccessStatusCode)
            {
                log.LogWarning("Department-routing LLM call failed: {Status}", res.StatusCode);
                return null;
            }
            return ParseResponse(await res.Content.ReadAsStringAsync(ct), candidates);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Department-routing LLM call errored");
            return null; // never throw into the reception flow
        }
    }

    // TODO(pending): replace with the client's real rules + few-shot examples.
    private static string BuildSystemPrompt(IReadOnlyList<string> candidates) =>
        "You route an emergency-medicine patient to ONE department from the admission reason. " +
        "Allowed departments: " + string.Join(", ", candidates) + ". " +
        "Reply ONLY as compact JSON: {\"departments\":[\"...\"],\"confidence\":0.0-1.0}. " +
        "If unsure, return the 2–3 most likely departments with a low confidence.";

    private static string BuildUserPrompt(string admissionReason, RoutingContext ctx)
    {
        var sb = new StringBuilder().Append("סיבת קבלה: ").Append(admissionReason);
        if (ctx.Age is int age) sb.Append("\nגיל: ").Append(age);
        if (!string.IsNullOrWhiteSpace(ctx.Gender)) sb.Append("\nמין: ").Append(ctx.Gender);
        return sb.ToString();
    }

    private static DepartmentClassification? ParseResponse(string json, IReadOnlyList<string> candidates)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var text = doc.RootElement.GetProperty("content")[0].GetProperty("text").GetString();
            if (string.IsNullOrWhiteSpace(text)) return null;
            // The model may wrap JSON in prose — extract the first {...} block.
            var start = text.IndexOf('{'); var end = text.LastIndexOf('}');
            if (start < 0 || end <= start) return null;
            var verdict = JsonSerializer.Deserialize<LlmVerdict>(text.Substring(start, end - start + 1), JsonOpts);
            if (verdict?.Departments is not { Count: > 0 }) return null;
            var depts = verdict.Departments.Where(candidates.Contains).ToList();
            if (depts.Count == 0) depts = verdict.Departments;
            return new DepartmentClassification(depts, Math.Clamp(verdict.Confidence, 0, 1));
        }
        catch
        {
            return null;
        }
    }

    private record LlmVerdict(List<string>? Departments, double Confidence);
}
