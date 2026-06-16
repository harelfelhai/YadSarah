using System.Globalization;
using System.Text;
using System.Text.Json;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public record MedicationSyncResult(bool Success, int Count, string Message);

/// <summary>
/// Refreshes the internal drug catalog from the two approved sources:
///   1. the MoH drug-registry API (weekly auto / admin-triggered), and
///   2. an admin-uploaded official file (CSV) — the offline fallback.
/// Both apply a FULL snapshot via <see cref="MedicationCatalogService.ReplaceAllAsync"/>.
/// A failed sync never throws into the app: it records status and leaves the last
/// good snapshot intact (clinical autocomplete keeps working offline).
/// </summary>
public class MedicationSyncService(HttpClient http, SettingsService settings, MedicationCatalogService catalog)
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    // Candidate JSON field names in the MoH response (defensive — the schema may vary).
    private static readonly string[] RegNumKeys = ["dragRegNum", "regNum", "registrationNumber", "RegNum"];
    private static readonly string[] HebNameKeys = ["dragHebName", "hebName", "name", "HebName"];
    private static readonly string[] EnNameKeys = ["dragEnName", "enName", "englishName", "EnName"];

    // ── API sync ──────────────────────────────────────────────────────────────
    public async Task<MedicationSyncResult> SyncFromApiAsync(CancellationToken ct = default)
    {
        try
        {
            var url = await settings.GetStringAsync(SettingsService.MedApiUrlKey, SettingsService.MedApiUrlDefault);
            if (string.IsNullOrWhiteSpace(url))
                return await RecordAsync(false, 0, "כתובת ה-API אינה מוגדרת.");

            var records = new List<MedicationRecord>();
            const int maxPages = 2000;
            for (var page = 1; page <= maxPages; page++)
            {
                ct.ThrowIfCancellationRequested();
                var payload = JsonSerializer.Serialize(new
                {
                    val = "",
                    prodStatus = "true",
                    healthServices = "false",
                    pageIndex = page,
                    orderBy = 0,
                });
                using var req = new HttpRequestMessage(HttpMethod.Post, url)
                {
                    Content = new StringContent(payload, Encoding.UTF8, "application/json"),
                };
                req.Headers.TryAddWithoutValidation("User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36");
                req.Headers.TryAddWithoutValidation("Accept", "application/json");

                using var resp = await http.SendAsync(req, ct);
                if (!resp.IsSuccessStatusCode)
                    return await RecordAsync(false, 0, $"שגיאת HTTP מה-API ({(int)resp.StatusCode}).");

                var json = await resp.Content.ReadAsStringAsync(ct);
                var pageRecords = ParseApiPage(json);
                if (pageRecords.Count == 0) break;     // no more results
                records.AddRange(pageRecords);
            }

            if (records.Count == 0)
                return await RecordAsync(false, 0, "ה-API לא החזיר תרופות (ייתכן חסום/בתחזוקה). נסה ייבוא קובץ.");

            var active = await catalog.ReplaceAllAsync(records);
            return await RecordAsync(true, active, $"סונכרנו {active} תרופות מה-API.");
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            return await RecordAsync(false, 0, $"כשל בסנכרון מה-API: {ex.Message}");
        }
    }

    private static List<MedicationRecord> ParseApiPage(string json)
    {
        var result = new List<MedicationRecord>();
        using var doc = JsonDocument.Parse(json);
        var arr = FindArray(doc.RootElement);
        if (arr is null) return result;

        foreach (var el in arr.Value.EnumerateArray())
        {
            if (el.ValueKind != JsonValueKind.Object) continue;
            var reg = GetFirst(el, RegNumKeys);
            var heb = GetFirst(el, HebNameKeys);
            var en = GetFirst(el, EnNameKeys);
            if (!string.IsNullOrWhiteSpace(reg) && !string.IsNullOrWhiteSpace(heb))
                result.Add(new MedicationRecord(reg!, heb!, en));
        }
        return result;
    }

    private static JsonElement? FindArray(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array) return root;
        if (root.ValueKind == JsonValueKind.Object)
            foreach (var name in new[] { "results", "Results", "items", "Items", "data", "Data", "products" })
                if (root.TryGetProperty(name, out var arr) && arr.ValueKind == JsonValueKind.Array)
                    return arr;
        return null;
    }

    private static string? GetFirst(JsonElement obj, string[] keys)
    {
        foreach (var k in keys)
            if (obj.TryGetProperty(k, out var v))
                return v.ValueKind switch
                {
                    JsonValueKind.String => v.GetString(),
                    JsonValueKind.Number => v.ToString(),
                    _ => null,
                };
        return null;
    }

    // ── File import (offline fallback): CSV or the official MoH .xlsx ───────────
    public async Task<MedicationSyncResult> ImportFromFileAsync(Stream stream, string fileName)
    {
        try
        {
            List<MedicationRecord> records;
            if (fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
            {
                records = BuildRecords(ReadXlsxRows(stream));
            }
            else
            {
                using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
                var content = await reader.ReadToEndAsync();
                records = BuildRecords(ReadCsvRows(content));
            }

            if (records.Count == 0)
                return await RecordAsync(false, 0, "הקובץ ריק או לא בפורמט נתמך (CSV/XLSX עם עמודות מספר רישום ושם).");

            var active = await catalog.ReplaceAllAsync(records);
            return await RecordAsync(true, active, $"יובאו {active} תרופות מהקובץ.");
        }
        catch (Exception ex)
        {
            return await RecordAsync(false, 0, $"כשל בייבוא הקובץ: {ex.Message}");
        }
    }

    // Reads the first worksheet of an .xlsx into rows of trimmed cell strings.
    private static List<string[]> ReadXlsxRows(Stream stream)
    {
        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        ms.Position = 0;
        using var wb = new ClosedXML.Excel.XLWorkbook(ms);
        var ws = wb.Worksheets.First();
        var rows = new List<string[]>();
        foreach (var row in ws.RowsUsed())
        {
            var lastCol = row.LastCellUsed()?.Address.ColumnNumber ?? 0;
            var cells = new string[lastCol];
            for (var c = 1; c <= lastCol; c++)
                cells[c - 1] = row.Cell(c).GetString();
            rows.Add(cells);
        }
        return rows;
    }

    private static List<string[]> ReadCsvRows(string content)
    {
        var rows = new List<string[]>();
        foreach (var line in content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
            if (!string.IsNullOrWhiteSpace(line))
                rows.Add(SplitCsvLine(line).ToArray());
        return rows;
    }

    // Header-aware row mapping. Recognizes the official MoH columns (מספר_תכשיר /
    // שם_בעברית / שם_באנגלית) and common English headers; falls back to positional
    // order (regNum, hebName, enName) when no known header is found. Candidates are
    // chosen to avoid false matches with similar columns (תאריך_רישום, תכשיר_וטרינרי).
    private static List<MedicationRecord> BuildRecords(List<string[]> rows)
    {
        var records = new List<MedicationRecord>();
        if (rows.Count == 0) return records;

        int regIdx = 0, hebIdx = 1, enIdx = 2, startRow = 0;
        var header = rows[0].Select(h => h.Trim().ToLowerInvariant()).ToList();

        // Note: candidates are specific to avoid false matches — e.g. "מרשם" (prescription)
        // contains the substring "שם", so the Hebrew-name column is matched by "עברית", not "שם".
        bool MatchAny(string h, params string[] cands) => cands.Any(c => h.Contains(c));
        var hasHeader = header.Any(h =>
            MatchAny(h, "dragregnum", "regnum", "registration", "מספר") ||
            MatchAny(h, "אנגלית", "עברית", "hebname", "english"));
        if (hasHeader)
        {
            for (var i = 0; i < header.Count; i++)
            {
                var h = header[i];
                if (MatchAny(h, "dragregnum", "regnum", "registration", "מספר")) regIdx = i;
                else if (MatchAny(h, "dragenname", "enname", "english", "אנגלית")) enIdx = i;
                else if (MatchAny(h, "draghebname", "hebname", "hebrew", "עברית", "name")) hebIdx = i;
            }
            startRow = 1;
        }

        for (var r = startRow; r < rows.Count; r++)
        {
            var cols = rows[r];
            string Col(int i) => i >= 0 && i < cols.Length ? cols[i].Trim() : "";
            var reg = Col(regIdx);
            var heb = Col(hebIdx);
            var en = Col(enIdx);
            if (!string.IsNullOrWhiteSpace(reg) && !string.IsNullOrWhiteSpace(heb))
                records.Add(new MedicationRecord(reg, heb, string.IsNullOrWhiteSpace(en) ? null : en));
        }
        return records;
    }

    // Minimal RFC4180-style field splitter (quoted fields, escaped quotes, no embedded newlines).
    private static List<string> SplitCsvLine(string line)
    {
        var fields = new List<string>();
        var sb = new StringBuilder();
        var inQuotes = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; }
                    else inQuotes = false;
                }
                else sb.Append(c);
            }
            else
            {
                if (c == '"') inQuotes = true;
                else if (c == ',') { fields.Add(sb.ToString()); sb.Clear(); }
                else sb.Append(c);
            }
        }
        fields.Add(sb.ToString());
        return fields;
    }

    // ── status persistence ──────────────────────────────────────────────────────
    private async Task<MedicationSyncResult> RecordAsync(bool ok, int count, string message)
    {
        if (ok)
        {
            await settings.SetSystemAsync(SettingsService.MedLastSyncAtKey, DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));
            await settings.SetSystemAsync(SettingsService.MedCountKey, count.ToString(CultureInfo.InvariantCulture));
        }
        await settings.SetSystemAsync(SettingsService.MedLastSyncStatusKey, message);
        return new MedicationSyncResult(ok, count, message);
    }
}
