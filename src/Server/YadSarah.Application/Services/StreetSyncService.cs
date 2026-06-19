using System.Globalization;
using System.Text;
using System.Text.Json;

namespace YadSarah.Application.Services;

public record StreetSyncResult(bool Success, int Count, string Message);

/// <summary>
/// Refreshes the internal streets catalog from data.gov.il ("רחובות בישראל", a CKAN
/// datastore) or an admin-uploaded CSV (the offline fallback). Both apply a FULL snapshot
/// via <see cref="StreetCatalogService.ReplaceAllAsync"/>. A failed sync never throws into
/// the app: it records status and leaves the last good snapshot intact (reception
/// autocomplete keeps working offline). Mirrors <see cref="MedicationSyncService"/>.
/// </summary>
public class StreetSyncService(HttpClient http, SettingsService settings, StreetCatalogService catalog)
{
    // A full sync truncates then bulk-inserts, so two concurrent runs (e.g. the startup
    // background check racing an admin-triggered sync) would interleave deletes/inserts and
    // produce duplicates. Serialize all snapshot replacements; a second caller skips.
    private static readonly SemaphoreSlim SyncGate = new(1, 1);

    // ── API sync (data.gov.il CKAN datastore_search, paged by offset) ───────────
    public async Task<StreetSyncResult> SyncFromApiAsync(CancellationToken ct = default)
    {
        if (!await SyncGate.WaitAsync(0, ct))
            return new StreetSyncResult(false, 0, "סנכרון רחובות כבר מתבצע — נסה שוב בעוד רגע.");
        try
        {
            var baseUrl = await settings.GetStringAsync(SettingsService.StreetsApiUrlKey, SettingsService.StreetsApiUrlDefault);
            var resourceId = await settings.GetStringAsync(SettingsService.StreetsResourceIdKey, SettingsService.StreetsResourceIdDefault);
            if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(resourceId))
                return await RecordAsync(false, 0, "כתובת ה-API של מאגר הרחובות אינה מוגדרת.");

            var records = new List<StreetRecord>();
            const int pageSize = 10000;
            const int maxPages = 200; // safety bound (covers >1M rows)
            for (var page = 0; page < maxPages; page++)
            {
                ct.ThrowIfCancellationRequested();
                var offset = page * pageSize;
                var url = $"{baseUrl}?resource_id={Uri.EscapeDataString(resourceId)}&limit={pageSize}&offset={offset}";
                using var resp = await http.GetAsync(url, ct);
                if (!resp.IsSuccessStatusCode)
                    return await RecordAsync(false, 0, $"שגיאת HTTP מה-API ({(int)resp.StatusCode}).");

                var json = await resp.Content.ReadAsStringAsync(ct);
                var pageRecords = ParseApiPage(json);
                if (pageRecords.Count == 0) break; // no more results
                records.AddRange(pageRecords);
                if (pageRecords.Count < pageSize) break;
            }

            if (records.Count == 0)
                return await RecordAsync(false, 0, "ה-API לא החזיר רחובות (ייתכן חסום/בתחזוקה). נסה ייבוא קובץ.");

            var count = await catalog.ReplaceAllAsync(records, ct);
            return await RecordAsync(true, count, $"סונכרנו {count} רחובות מ-data.gov.il.");
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            return await RecordAsync(false, 0, $"כשל בסנכרון מה-API: {ex.Message}");
        }
        finally { SyncGate.Release(); }
    }

    private static List<StreetRecord> ParseApiPage(string json)
    {
        var result = new List<StreetRecord>();
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("result", out var res)) return result;
        if (!res.TryGetProperty("records", out var arr) || arr.ValueKind != JsonValueKind.Array) return result;

        foreach (var el in arr.EnumerateArray())
        {
            if (el.ValueKind != JsonValueKind.Object) continue;
            var city = GetString(el, "שם_ישוב");
            var street = GetString(el, "שם_רחוב");
            if (!string.IsNullOrWhiteSpace(city) && !string.IsNullOrWhiteSpace(street))
                result.Add(new StreetRecord(city!, street!));
        }
        return result;
    }

    private static string? GetString(JsonElement obj, string key) =>
        obj.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    // ── File import (offline fallback): CSV with city,street columns ────────────
    public async Task<StreetSyncResult> ImportFromFileAsync(Stream stream, CancellationToken ct = default)
    {
        if (!await SyncGate.WaitAsync(0, ct))
            return new StreetSyncResult(false, 0, "סנכרון רחובות כבר מתבצע — נסה שוב בעוד רגע.");
        try
        {
            using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            var content = await reader.ReadToEndAsync(ct);
            var records = BuildRecords(content);

            if (records.Count == 0)
                return await RecordAsync(false, 0, "הקובץ ריק או לא בפורמט נתמך (CSV עם עמודות עיר ורחוב).");

            var count = await catalog.ReplaceAllAsync(records, ct);
            return await RecordAsync(true, count, $"יובאו {count} רחובות מהקובץ.");
        }
        catch (Exception ex)
        {
            return await RecordAsync(false, 0, $"כשל בייבוא הקובץ: {ex.Message}");
        }
        finally { SyncGate.Release(); }
    }

    // Header-aware: recognizes שם_ישוב / שם_רחוב (or city/street); falls back to
    // positional order (city, street) when no known header is found.
    private static List<StreetRecord> BuildRecords(string content)
    {
        var rows = new List<string[]>();
        foreach (var line in content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
            if (!string.IsNullOrWhiteSpace(line))
                rows.Add(SplitCsvLine(line).ToArray());

        var records = new List<StreetRecord>();
        if (rows.Count == 0) return records;

        int cityIdx = 0, streetIdx = 1, startRow = 0;
        var header = rows[0].Select(h => h.Trim().ToLowerInvariant()).ToList();
        bool MatchAny(string h, params string[] cands) => cands.Any(h.Contains);
        var hasHeader = header.Any(h => MatchAny(h, "ישוב", "עיר", "city") || MatchAny(h, "רחוב", "street"));
        if (hasHeader)
        {
            for (var i = 0; i < header.Count; i++)
            {
                if (MatchAny(header[i], "ישוב", "עיר", "city")) cityIdx = i;
                else if (MatchAny(header[i], "רחוב", "street")) streetIdx = i;
            }
            startRow = 1;
        }

        for (var r = startRow; r < rows.Count; r++)
        {
            var cols = rows[r];
            string Col(int i) => i >= 0 && i < cols.Length ? cols[i].Trim() : "";
            var city = Col(cityIdx);
            var street = Col(streetIdx);
            if (!string.IsNullOrWhiteSpace(city) && !string.IsNullOrWhiteSpace(street))
                records.Add(new StreetRecord(city, street));
        }
        return records;
    }

    // Minimal RFC4180-style field splitter (quoted fields, escaped quotes).
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
    private async Task<StreetSyncResult> RecordAsync(bool ok, int count, string message)
    {
        if (ok)
        {
            await settings.SetSystemAsync(SettingsService.StreetsLastSyncAtKey, DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));
            await settings.SetSystemAsync(SettingsService.StreetsCountKey, count.ToString(CultureInfo.InvariantCulture));
        }
        await settings.SetSystemAsync(SettingsService.StreetsLastSyncStatusKey, message);
        return new StreetSyncResult(ok, count, message);
    }
}
