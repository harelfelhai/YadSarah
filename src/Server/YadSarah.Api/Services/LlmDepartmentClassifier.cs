using System.Text;
using System.Text.Json;
using YadSarah.Application.Services;

namespace YadSarah.Api.Services;

/// <summary>
/// LLM-backed department classifier (Google Gemini, default model: gemini-2.5-flash). Config-gated:
/// returns null (⇒ deterministic fallback) unless <c>DepartmentRouting:Enabled</c> is true AND an
/// API key is present. Internet in the critical path is permitted (on-prem dropped 2026-06-19).
///
/// Zero-shot by clinical logic (no few-shot examples) — the department descriptions in
/// <see cref="BuildSystemPrompt"/> are what steer routing, returned as a ranked list (best first).
/// A per-call 8s timeout keeps a slow/hung call from freezing the reception clerk (falls back to the
/// deterministic set). Config keys (appsettings / env — the API key is a SECRET, never the DB):
/// DepartmentRouting:{Enabled,ApiKey,Model}. The key is sent as the x-goog-api-key header.
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

        var model = config["DepartmentRouting:Model"] ?? "gemini-2.5-flash";
        try
        {
            var body = new
            {
                systemInstruction = new { parts = new[] { new { text = BuildSystemPrompt(candidates) } } },
                contents = new[]
                {
                    new { role = "user", parts = new[] { new { text = BuildUserPrompt(admissionReason, ctx) } } },
                },
                generationConfig = new
                {
                    temperature = 0,
                    // Headroom so a stray "thinking" burst can't starve the JSON output (which would
                    // come back as MAX_TOKENS with empty parts → an unwanted fallback). The model still
                    // stops as soon as the short JSON is complete.
                    maxOutputTokens = 1024,
                    responseMimeType = "application/json",
                    // Disable "thinking" so the short classification stays fast (supported by 2.5 models).
                    thinkingConfig = new { thinkingBudget = 0 },
                },
                // Clinical free text (symptoms, injuries, paediatric cases) must not be dropped by the
                // default safety filters — that produced intermittent empty responses. BLOCK_NONE on the
                // configurable categories; this is a routing aid over non-identifying reason text.
                safetySettings = new[]
                {
                    new { category = "HARM_CATEGORY_HARASSMENT", threshold = "BLOCK_NONE" },
                    new { category = "HARM_CATEGORY_HATE_SPEECH", threshold = "BLOCK_NONE" },
                    new { category = "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold = "BLOCK_NONE" },
                    new { category = "HARM_CATEGORY_DANGEROUS_CONTENT", threshold = "BLOCK_NONE" },
                },
            };
            var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
            using var msg = new HttpRequestMessage(HttpMethod.Post, url);
            msg.Headers.Add("x-goog-api-key", apiKey);
            msg.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

            // Bound the wait so a slow LLM never blocks the reception flow past ~8s.
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(8));

            using var res = await http.SendAsync(msg, timeoutCts.Token);
            var bodyText = await res.Content.ReadAsStringAsync(timeoutCts.Token);
            if (!res.IsSuccessStatusCode)
            {
                log.LogWarning("Department-routing Gemini call failed: {Status} {Body}", res.StatusCode, Trunc(bodyText));
                return null;
            }
            var parsed = ParseResponse(bodyText, candidates);
            // Log the raw body when we fall back despite a 200 — surfaces finishReason / blockReason.
            if (parsed is null)
                log.LogWarning("Department-routing Gemini returned no usable verdict: {Body}", Trunc(bodyText));
            return parsed;
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Department-routing Gemini call errored");
            return null; // never throw into the reception flow
        }
    }

    // Zero-shot routing by clinical logic. The department "mhut" (nature) descriptions are the
    // steering signal; the allowed set is injected dynamically (age-gates may drop "ילדים"/"אורטופדיה").
    // The model returns the departments ranked best-first; DepartmentRoutingService always collapses
    // that ranking to a SINGLE department (top pick, or the priority order when ambiguous).
    private static string BuildSystemPrompt(IReadOnlyList<string> candidates) =>
        $$"""
        אתה מנתב מטופלים במלר"ד (מיון) למחלקה, לפי סיבת הקבלה (וגיל/מין אם נתונים).

        המחלקות ומהותן:
        • רפואה דחופה — מיון כללי למבוגרים: מצבים אקוטיים שאינם משויכים לתת-התמחות אחרת — כאב כללי,
          חום, חולשה/עילפון, קוצר נשימה, כאב חזה/בטן, בחילות/הקאות, זיהומים, מצבים פנימיים, הרעלות.
          זוהי ברירת המחדל כשאין התאמה ברורה למחלקה ייעודית.
        • ילדים — כל מטופל עד גיל 17 (כולל), בכל תלונה שהיא. הגיל גובר על סוג התלונה.
        • אורטופדיה — פגיעות שלד-שריר: שברים, פריקות, נקעים, חבלות לגפיים/גב, חשד לשבר,
          כאב מפרקים לאחר חבלה, פציעות ספורט.
        • נשים — מצבים גינקולוגיים ומיילדותיים: היריון, צירי לידה, דימום וגינלי,
          כאב בטן תחתונה בהקשר גינקולוגי, תלונות שד, מצבים שלאחר לידה.
        • עירוי תרופות — הגעה יזומה לעירוי/טיפול תרופתי מתוכנן (אנטיביוטיקה IV, כימותרפיה,
          תרופות ביולוגיות, נוזלים) — המשך טיפול מוכר, לא מצב חירום אקוטי.
        • ביקורת — מטופל שמגיע לביקורת חוזרת / מעקב אצל רופא ספציפי (לא פנייה חדשה). נתב לכאן אם
          סיבת הקבלה היא "ביקורת", או אם היא מקושרת לרופא בשם "מתי". שים לב: "מתי" היא גם מילת שאלה
          בעברית ("when") — הבחן לפי ההקשר בין שם של רופא (למשל "ביקורת אצל מתי", "ד״ר מתי") לבין
          שימוש לשוני רגיל ("מתי כדאי להגיע").

        כללים:
        1. בחר אך ורק מתוך הרשימה המותרת: {{string.Join(", ", candidates)}}.
        2. אם גיל המטופל ≤ 17 ו-"ילדים" נמצאת ברשימה המותרת — "ילדים" היא הראשונה. חריג: ביקורת
           חוזרת אצל רופא ספציפי גוברת על הגיל.
        3. אישה בהיריון או שמצוין "שבוע X" (שבוע היריון) → "נשים".
        4. החזר את המחלקות מדורגות לפי התאמה, הטובה ביותר ראשונה. מקרה חד-משמעי → מחלקה אחת
           בודאות גבוהה (0.8–1.0). במקרה עמום בין כמה מחלקות דרג אותן לפי סדר העדיפות
           נשים → רפואה דחופה → אורטופדיה, בודאות נמוכה (מתחת ל-0.7).
        5. השב אך ורק כ-JSON קומפקטי, ללא טקסט נוסף:
           {"departments":["..."],"confidence":0.0-1.0}
        """;

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
            var text = doc.RootElement
                .GetProperty("candidates")[0]
                .GetProperty("content")
                .GetProperty("parts")[0]
                .GetProperty("text").GetString();
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

    private static string Trunc(string? s) =>
        string.IsNullOrEmpty(s) ? "" : s.Length <= 600 ? s : s[..600];

    private record LlmVerdict(List<string>? Departments, double Confidence);
}
